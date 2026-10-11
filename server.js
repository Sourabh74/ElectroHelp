const crypto = require("node:crypto");
const { promisify } = require("node:util");
const path = require("node:path");
const express = require("express");
const config = require("./server/config");
const { pool, initializeDatabase } = require("./server/db");

const scrypt = promisify(crypto.scrypt);
const app = express();
const root = __dirname;
const schema = `"${config.database.schema}"`;
const SESSION_COOKIE = "current_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(";") || [];
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

function sessionCookie(token, maxAgeSeconds) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest();
}

function publicAccount(account) {
  return {
    id: String(account.id),
    name: account.name,
    email: account.email,
    accountType: account.account_type,
  };
}

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function requireAuth(accountType) {
  return async (request, response, next) => {
    const token = cookieValue(request, SESSION_COOKIE);
    if (!token) return sendError(response, 401, "Please log in to continue.");

    try {
      const result = await pool.query(
        `SELECT a.id, a.name, a.email, a.account_type
         FROM ${schema}.sessions s
         JOIN ${schema}.accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [hashToken(token)],
      );
      if (result.rowCount === 0) return sendError(response, 401, "Your session has expired. Please log in again.");
      request.user = publicAccount(result.rows[0]);
      if (accountType && request.user.accountType !== accountType) {
        return sendError(response, 403, "This action is not available for your account.");
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function validateEmail(email) {
  return typeof email === "string" && email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateText(value, maxLength, required = false) {
  return typeof value === "string" && value.length <= maxLength && (!required || value.trim().length > 0);
}

function mapRequest(row) {
  return {
    id: String(row.id),
    issue: row.issue,
    location: row.location,
    description: row.description,
    phone: row.phone,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    createdAt: row.created_at.toISOString(),
    date: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(row.created_at),
  };
}

const requestColumns = `r.id, r.issue, r.location, r.description, r.phone, r.status,
  r.created_at, a.name AS customer_name, a.email AS customer_email`;

app.get("/api/health", async (request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", async (request, response, next) => {
  const { name, email, password, accountType } = request.body || {};
  if (!validateText(name, 80, true) || !validateEmail(email) ||
      typeof password !== "string" || password.length < 8 || password.length > 128 ||
      !["customer", "electrician"].includes(accountType)) {
    return sendError(response, 400, "Enter a valid name, email, password (at least 8 characters), and account type.");
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64);
    const result = await pool.query(
      `INSERT INTO ${schema}.accounts (name, email, account_type, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, account_type`,
      [name.trim(), normalizedEmail, accountType, salt, passwordHash],
    );
    response.status(201).json({ user: publicAccount(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") return sendError(response, 409, "An account with this email already exists.");
    return next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const { email, password, accountType } = request.body || {};
  if (!validateEmail(email) || typeof password !== "string" ||
      !["customer", "electrician"].includes(accountType)) {
    return sendError(response, 400, "Enter a valid email, password, and account type.");
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, account_type, password_salt, password_hash
       FROM ${schema}.accounts
       WHERE email = $1 AND account_type = $2`,
      [email.trim().toLowerCase(), accountType],
    );
    if (result.rowCount === 0) return sendError(response, 401, "Email or password is incorrect.");

    const account = result.rows[0];
    const candidate = await scrypt(password, account.password_salt, account.password_hash.length);
    if (!crypto.timingSafeEqual(candidate, account.password_hash)) {
      return sendError(response, 401, "Email or password is incorrect.");
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await pool.query(
      `INSERT INTO ${schema}.sessions (token_hash, account_id, expires_at)
       VALUES ($1, $2, $3)`,
      [hashToken(token), account.id, expiresAt],
    );
    response.setHeader("Set-Cookie", sessionCookie(token, SESSION_DURATION_MS / 1000));
    response.json({ user: publicAccount(account) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (request, response, next) => {
  const token = cookieValue(request, SESSION_COOKIE);
  try {
    if (token) {
      await pool.query(`DELETE FROM ${schema}.sessions WHERE token_hash = $1`, [hashToken(token)]);
    }
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", async (request, response, next) => {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return response.json({ user: null });
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, a.email, a.account_type
       FROM ${schema}.sessions s
       JOIN ${schema}.accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashToken(token)],
    );
    response.json({ user: result.rowCount ? publicAccount(result.rows[0]) : null });
  } catch (error) {
    next(error);
  }
});

app.get("/api/requests", requireAuth(), async (request, response, next) => {
  try {
    const result = request.user.accountType === "electrician"
      ? await pool.query(
        `SELECT ${requestColumns}
         FROM ${schema}.service_requests r
         JOIN ${schema}.accounts a ON a.id = r.customer_id
         ORDER BY r.created_at DESC`,
      )
      : await pool.query(
        `SELECT ${requestColumns}
         FROM ${schema}.service_requests r
         JOIN ${schema}.accounts a ON a.id = r.customer_id
         WHERE r.customer_id = $1
         ORDER BY r.created_at DESC`,
        [request.user.id],
      );
    response.json({ requests: result.rows.map(mapRequest) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/requests", requireAuth("customer"), async (request, response, next) => {
  const { issue, location, description = "", phone = "" } = request.body || {};
  if (!validateText(issue, 120, true) || !validateText(location, 100, true) ||
      !validateText(description, 1000) || !validateText(phone, 30)) {
    return sendError(response, 400, "Enter a valid issue and location. Check the maximum field lengths.");
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${schema}.service_requests (customer_id, issue, location, description, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [request.user.id, issue.trim(), location.trim(), description.trim(), phone.trim()],
    );
    const created = await pool.query(
      `SELECT ${requestColumns}
       FROM ${schema}.service_requests r
       JOIN ${schema}.accounts a ON a.id = r.customer_id
       WHERE r.id = $1`,
      [result.rows[0].id],
    );
    response.status(201).json({ request: mapRequest(created.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/requests/:id/status", requireAuth("electrician"), async (request, response, next) => {
  const { status } = request.body || {};
  if (!/^\d+$/.test(request.params.id) || !["accepted", "declined", "completed"].includes(status)) {
    return sendError(response, 400, "The request id or status is invalid.");
  }

  const allowedPrevious = status === "completed" ? "accepted" : "pending";
  try {
    const result = await pool.query(
      `UPDATE ${schema}.service_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status = $3
       RETURNING id`,
      [status, request.params.id, allowedPrevious],
    );
    if (result.rowCount === 0) {
      const exists = await pool.query(`SELECT 1 FROM ${schema}.service_requests WHERE id = $1`, [request.params.id]);
      return sendError(response, exists.rowCount ? 409 : 404,
        exists.rowCount ? "This request has already been updated." : "Request not found.");
    }

    const updated = await pool.query(
      `SELECT ${requestColumns}
       FROM ${schema}.service_requests r
       JOIN ${schema}.accounts a ON a.id = r.customer_id
       WHERE r.id = $1`,
      [request.params.id],
    );
    response.json({ request: mapRequest(updated.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get("/", (request, response) => response.sendFile(path.join(root, "index.html")));
app.get("/index.html", (request, response) => response.sendFile(path.join(root, "index.html")));
app.get("/app.js", (request, response) => response.type("application/javascript").sendFile(path.join(root, "app.js")));
app.get("/styles.css", (request, response) => response.type("text/css").sendFile(path.join(root, "styles.css")));
app.get("/favicon.ico", (request, response) => response.sendStatus(204));

app.use((request, response) => sendError(response, 404, "Not found."));
app.use((error, request, response, next) => {
  console.error("Request failed:", error);
  if (response.headersSent) return next(error);
  return sendError(response, 500, "Something went wrong. Please try again.");
});

async function start() {
  await initializeDatabase();
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`Current is listening on port ${config.port}`);
  });
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error("Could not start Current:", error.message);
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { app, start };
