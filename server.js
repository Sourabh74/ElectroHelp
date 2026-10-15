const crypto = require("node:crypto");
const { promisify } = require("node:util");
const path = require("node:path");
const express = require("express");
const nodemailer = require("nodemailer");
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
  return entry ? entry.slice(name.length + 1) : null;
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
    serviceCity: account.service_city || null,
    serviceLatitude: account.service_latitude ?? null,
    serviceLongitude: account.service_longitude ?? null,
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
        `SELECT a.id, a.name, a.email, a.account_type, a.service_city,
                a.service_latitude, a.service_longitude
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

function validateRegistration({ name, email, password, accountType }) {
  const fieldErrors = {};
  if (typeof name !== "string" || !name.trim()) {
    fieldErrors.name = "Enter your name.";
  } else if (name.trim().length > 80) {
    fieldErrors.name = "Your name must be 80 characters or fewer.";
  }
  if (typeof email !== "string" || !email.trim()) {
    fieldErrors.email = "Enter your email address.";
  } else if (!validateEmail(email.trim())) {
    fieldErrors.email = "Enter a valid email address.";
  }
  if (typeof password !== "string" || !password) {
    fieldErrors.password = "Enter a password.";
  } else if (password.length < 8 || password.length > 128) {
    fieldErrors.password = "Password must be between 8 and 128 characters.";
  }
  return fieldErrors;
}

function emailOtpConfigured() {
  return Boolean(config.email.otpSecret && config.email.otpSecret.length >= 32 &&
    config.email.smtpHost && config.email.smtpFrom);
}

function createOtpHash(email, purpose, code, salt) {
  return crypto.createHmac("sha256", config.email.otpSecret)
    .update(`${email}:${purpose}:${salt.toString("hex")}:${code}`)
    .digest();
}

async function sendOtpEmail(email, purpose, code) {
  const transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    ...(config.email.smtpUser ? {
      auth: { user: config.email.smtpUser, pass: config.email.smtpPass },
    } : {}),
  });
  const isRegistration = purpose === "registration";
  await transporter.sendMail({
    from: config.email.smtpFrom,
    to: email,
    subject: isRegistration ? "Verify your ElectroHelp email" : "Reset your ElectroHelp password",
    text: `Your ElectroHelp verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your ElectroHelp verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  });
}

async function issueOtp(email, purpose, shouldSend) {
  const code = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16);
  const codeHash = createOtpHash(email, purpose, code, salt);
  const result = await pool.query(
    `INSERT INTO ${schema}.email_otp_challenges AS challenge
       (email, purpose, code_salt, code_hash, attempts, expires_at, last_sent_at)
     VALUES ($1, $2, $3, $4, 0, NOW() + INTERVAL '10 minutes', NOW())
     ON CONFLICT (email, purpose) DO UPDATE
       SET code_salt = EXCLUDED.code_salt, code_hash = EXCLUDED.code_hash,
           attempts = 0, expires_at = EXCLUDED.expires_at, last_sent_at = NOW()
       WHERE challenge.last_sent_at <= NOW() - INTERVAL '60 seconds'
          OR challenge.expires_at <= NOW()
     RETURNING email`,
    [email, purpose, salt, codeHash],
  );
  if (result.rowCount === 0) return false;
  if (shouldSend) {
    try {
      await sendOtpEmail(email, purpose, code);
    } catch (error) {
      await pool.query(
        `DELETE FROM ${schema}.email_otp_challenges
         WHERE email = $1 AND purpose = $2 AND code_hash = $3`,
        [email, purpose, codeHash],
      );
      throw Object.assign(new Error("Email delivery failed.", { cause: error }), {
        code: "EMAIL_DELIVERY_FAILED",
      });
    }
  }
  return true;
}

async function verifyOtp(client, email, purpose, code) {
  const result = await client.query(
    `SELECT code_salt, code_hash, attempts, expires_at
     FROM ${schema}.email_otp_challenges
     WHERE email = $1 AND purpose = $2
     FOR UPDATE`,
    [email, purpose],
  );
  if (result.rowCount === 0) return false;
  const challenge = result.rows[0];
  if (challenge.attempts >= 5 || new Date(challenge.expires_at) <= new Date()) {
    await client.query(
      `DELETE FROM ${schema}.email_otp_challenges WHERE email = $1 AND purpose = $2`,
      [email, purpose],
    );
    return false;
  }
  const candidate = createOtpHash(email, purpose, code, challenge.code_salt);
  if (!crypto.timingSafeEqual(candidate, challenge.code_hash)) {
    await client.query(
      `UPDATE ${schema}.email_otp_challenges
       SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2`,
      [email, purpose],
    );
    return false;
  }
  return true;
}

function mapRequest(row) {
  return {
    id: String(row.id),
    issue: row.issue,
    location: row.location,
    description: row.description,
    phone: row.phone,
    status: row.status,
    serviceAddress: row.service_address,
    addressInstructions: row.service_address_instructions,
    serviceCity: row.service_city,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    electricianName: row.electrician_name,
    electricianPhone: row.electrician_phone,
    estimatedResolution: row.estimated_resolution,
    createdAt: row.created_at.toISOString(),
    date: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(row.created_at),
  };
}

const requestColumns = `r.id, r.issue, r.location, r.description, r.phone, r.status,
  r.electrician_phone, r.estimated_resolution, r.service_address,
  r.service_address_instructions, r.service_city,
  r.created_at, r.dispatch_started_at,
  a.name AS customer_name, a.email AS customer_email, e.name AS electrician_name`;
const requestJoins = `JOIN ${schema}.accounts a ON a.id = r.customer_id
  LEFT JOIN ${schema}.accounts e ON e.id = r.electrician_id`;
const nearestElectricianId = `(SELECT candidate.id
  FROM ${schema}.accounts candidate
  WHERE candidate.account_type = 'electrician'
    AND LOWER(BTRIM(candidate.service_city)) = LOWER(BTRIM(r.service_city))
    AND candidate.service_latitude IS NOT NULL
    AND candidate.service_longitude IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ${schema}.service_request_excluded_electricians x
      WHERE x.request_id = r.id AND x.electrician_id = candidate.id
    )
  ORDER BY 2 * 6371 * ASIN(SQRT(LEAST(1,
    POWER(SIN(RADIANS(candidate.service_latitude - r.service_latitude) / 2), 2)
    + COS(RADIANS(r.service_latitude)) * COS(RADIANS(candidate.service_latitude))
      * POWER(SIN(RADIANS(candidate.service_longitude - r.service_longitude) / 2), 2)
  ))), candidate.id
  LIMIT 1)`;
function dispatchVisibility(electricianId) {
  return `EXISTS (
    SELECT 1 FROM ${schema}.accounts eligible
    WHERE eligible.id = ${electricianId}
      AND eligible.account_type = 'electrician'
      AND LOWER(BTRIM(eligible.service_city)) = LOWER(BTRIM(r.service_city))
      AND NOT EXISTS (
        SELECT 1 FROM ${schema}.service_request_excluded_electricians x
        WHERE x.request_id = r.id AND x.electrician_id = eligible.id
      )
      AND (eligible.id = ${nearestElectricianId}
        OR r.dispatch_started_at <= NOW() - INTERVAL '15 minutes')
  )`;
}

app.get("/api/health", async (request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register/send-code", async (request, response, next) => {
  const { name, email, password, accountType } = request.body || {};
  const fieldErrors = validateRegistration({ name, email, password, accountType });
  if (Object.keys(fieldErrors).length > 0) {
    return response.status(400).json({ error: "Please correct the highlighted fields.", fieldErrors });
  }
  if (accountType !== "electrician" && accountType !== "customer") {
    return sendError(response, 400, "Only customer/electrician accounts can be created here.");
  }
  if (!emailOtpConfigured()) {
    return sendError(response, 503, "Email verification is not configured. Please contact the site administrator.");
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query(
      `SELECT 1 FROM ${schema}.accounts WHERE email = $1`,
      [normalizedEmail],
    );
    if (existing.rowCount > 0) {
      return response.status(409).json({
        error: "An account with this email already exists.",
        fieldErrors: { email: "An account with this email already exists." },
      });
    }
    const sent = await issueOtp(normalizedEmail, "registration", true);
    if (!sent) return sendError(response, 429, "Please wait a minute before requesting another code.");
    response.json({ ok: true });
  } catch (error) {
    if (error.code === "EMAIL_DELIVERY_FAILED") {
      console.error("Could not send registration verification email:", error.cause);
      return sendError(response, 502, "We could not send your verification email. Please try again.");
    }
    return next(error);
  }
});

app.post("/api/auth/register/verify-code", async (request, response, next) => {
  const { name, email, password, accountType, code } = request.body || {};
  const fieldErrors = validateRegistration({ name, email, password, accountType });
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    fieldErrors.code = "Enter the 6-digit code sent to your email.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return response.status(400).json({ error: "Please correct the highlighted fields.", fieldErrors });
  }
  if (accountType !== "electrician" && accountType !== "customer") {
    return sendError(response, 400, "Only customer/electrician accounts can be created here.");
  }
  if (!emailOtpConfigured()) {
    return sendError(response, 503, "Email verification is not configured. Please contact the site administrator.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await verifyOtp(client, normalizedEmail, "registration", code)) {
      await client.query("COMMIT");
      return response.status(400).json({
        error: "That code is invalid or expired. Request a new code and try again.",
        fieldErrors: { code: "That code is invalid or expired." },
      });
    }
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64);
    const result = await client.query(
      `INSERT INTO ${schema}.accounts (name, email, account_type, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, account_type`,
      [name.trim(), normalizedEmail, accountType, salt, passwordHash],
    );
    await client.query(
      `DELETE FROM ${schema}.email_otp_challenges WHERE email = $1 AND purpose = 'registration'`,
      [normalizedEmail],
    );
    await client.query("COMMIT");
    response.status(201).json({ user: publicAccount(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return response.status(409).json({
        error: "An account with this email already exists.",
        fieldErrors: { email: "An account with this email already exists." },
      });
    }
    return next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/password-reset/send-code", async (request, response, next) => {
  const { email } = request.body || {};
  if (typeof email !== "string" || !validateEmail(email.trim())) {
    return response.status(400).json({
      error: "Please enter a valid email address.",
      fieldErrors: { email: "Enter a valid email address." },
    });
  }
  if (!emailOtpConfigured()) {
    return sendError(response, 503, "Email verification is not configured. Please contact the site administrator.");
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const account = await pool.query(
      `SELECT 1 FROM ${schema}.accounts WHERE email = $1`,
      [normalizedEmail],
    );
    const sent = await issueOtp(normalizedEmail, "password_reset", account.rowCount > 0);
    if (!sent) return sendError(response, 429, "Please wait a minute before requesting another code.");
    response.json({ ok: true });
  } catch (error) {
    if (error.code === "EMAIL_DELIVERY_FAILED") {
      console.error("Could not send password reset email:", error.cause);
      return sendError(response, 502, "We could not send your verification email. Please try again.");
    }
    return next(error);
  }
});

app.post("/api/auth/password-reset/confirm", async (request, response, next) => {
  const { email, code, password } = request.body || {};
  const fieldErrors = {};
  if (typeof email !== "string" || !validateEmail(email.trim())) {
    fieldErrors.email = "Enter a valid email address.";
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    fieldErrors.code = "Enter the 6-digit code sent to your email.";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    fieldErrors.password = "Password must be between 8 and 128 characters.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return response.status(400).json({ error: "Please correct the highlighted fields.", fieldErrors });
  }
  if (!emailOtpConfigured()) {
    return sendError(response, 503, "Email verification is not configured. Please contact the site administrator.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await verifyOtp(client, normalizedEmail, "password_reset", code)) {
      await client.query("COMMIT");
      return response.status(400).json({
        error: "That code is invalid or expired. Request a new code and try again.",
        fieldErrors: { code: "That code is invalid or expired." },
      });
    }
    const account = await client.query(
      `SELECT id FROM ${schema}.accounts WHERE email = $1 FOR UPDATE`,
      [normalizedEmail],
    );
    if (account.rowCount === 0) {
      await client.query(
        `DELETE FROM ${schema}.email_otp_challenges WHERE email = $1 AND purpose = 'password_reset'`,
        [normalizedEmail],
      );
      await client.query("COMMIT");
      return sendError(response, 400, "That code is invalid or expired. Request a new code and try again.");
    }
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64);
    await client.query(
      `UPDATE ${schema}.accounts SET password_salt = $1, password_hash = $2 WHERE id = $3`,
      [salt, passwordHash, account.rows[0].id],
    );
    await client.query(
      `DELETE FROM ${schema}.sessions WHERE account_id = $1`,
      [account.rows[0].id],
    );
    await client.query(
      `DELETE FROM ${schema}.email_otp_challenges WHERE email = $1 AND purpose = 'password_reset'`,
      [normalizedEmail],
    );
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const { email, password, accountType } = request.body || {};
  const fieldErrors = {};
  if (typeof email !== "string" || !email.trim()) {
    fieldErrors.email = "Enter your email address.";
  } else if (!validateEmail(email.trim())) {
    fieldErrors.email = "Enter a valid email address.";
  }
  if (typeof password !== "string" || !password) {
    fieldErrors.password = "Enter your password.";
  } else if (password.length < 8 || password.length > 128) {
    fieldErrors.password = "Password must be between 8 and 128 characters.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return response.status(400).json({ error: "Please correct the highlighted fields.", fieldErrors });
  }
  if (!["customer", "electrician"].includes(accountType)) {
    return sendError(response, 400, "Choose a valid account type.");
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, account_type, password_salt, password_hash,
              service_city, service_latitude, service_longitude
       FROM ${schema}.accounts
       WHERE email = $1 AND account_type = $2`,
      [email.trim().toLowerCase(), accountType],
    );
    if (result.rowCount === 0) {
      return response.status(401).json({
        error: "Email or password is incorrect.",
        fieldErrors: { password: "Email or password is incorrect." },
      });
    }

    const account = result.rows[0];
    const candidate = await scrypt(password, account.password_salt, account.password_hash.length);
    if (!crypto.timingSafeEqual(candidate, account.password_hash)) {
      return response.status(401).json({
        error: "Email or password is incorrect.",
        fieldErrors: { password: "Email or password is incorrect." },
      });
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
      `SELECT a.id, a.name, a.email, a.account_type, a.service_city,
              a.service_latitude, a.service_longitude
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

app.put("/api/profile/service-area", requireAuth("electrician"), async (request, response, next) => {
  const { city, latitude, longitude } = request.body || {};
  if (!validateText(city, 120, true) ||
      typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return sendError(response, 400, "Choose a valid service city and map location.");
  }

  try {
    const result = await pool.query(
      `UPDATE ${schema}.accounts
       SET service_city = $1, service_latitude = $2, service_longitude = $3
       WHERE id = $4 AND account_type = 'electrician'
       RETURNING id, name, email, account_type, service_city, service_latitude, service_longitude`,
      [city.trim(), latitude, longitude, request.user.id],
    );
    response.json({ user: publicAccount(result.rows[0]) });
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
         ${requestJoins}
         WHERE r.electrician_id = $1
           OR (r.status = 'pending' AND ${dispatchVisibility("$1")})
         ORDER BY r.created_at DESC`,
        [request.user.id],
      )
      : await pool.query(
        `SELECT ${requestColumns}
         FROM ${schema}.service_requests r
         ${requestJoins}
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
  const {
    issue, location, serviceAddress, addressInstructions = "", serviceCity,
    latitude, longitude, description = "", phone = "",
  } = request.body || {};
  if (!validateText(issue, 120, true) || !validateText(location, 100, true) ||
      !validateText(serviceAddress, 250, true) || !validateText(serviceCity, 120, true) ||
      !validateText(addressInstructions, 500) ||
      typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !validateText(description, 1000) || !validateText(phone, 30)) {
    return sendError(response, 400, "Enter a valid issue, location, address and city, and choose the address on the map.");
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${schema}.service_requests
         (customer_id, issue, location, service_address, service_address_instructions,
          service_city, service_latitude, service_longitude, description, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [request.user.id, issue.trim(), location.trim(), serviceAddress.trim(), addressInstructions.trim(),
        serviceCity.trim(), latitude, longitude, description.trim(), phone.trim()],
    );
    const created = await pool.query(
      `SELECT ${requestColumns}
       FROM ${schema}.service_requests r
       ${requestJoins}
       WHERE r.id = $1`,
      [result.rows[0].id],
    );
    response.status(201).json({ request: mapRequest(created.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/requests/:id/status", requireAuth("electrician"), async (request, response, next) => {
  const { status, electricianPhone, estimatedResolution } = request.body || {};
  const requestId = request.params.id;
  if (!/^[1-9]\d{0,18}$/.test(requestId) ||
      BigInt(requestId) > 9223372036854775807n ||
      !["accepted", "declined", "completed"].includes(status)) {
    return sendError(response, 400, "The request id or status is invalid.");
  }
  if (status === "accepted" &&
      (!validateText(electricianPhone, 30, true) || !validateText(estimatedResolution, 100, true))) {
    return sendError(response, 400, "Enter a valid phone number and estimated resolution time.");
  }

  try {
    if (status === "declined") {
      const declined = await pool.query(
        `INSERT INTO ${schema}.service_request_excluded_electricians (request_id, electrician_id)
         SELECT r.id, $2
         FROM ${schema}.service_requests r
         WHERE r.id = $1 AND r.status = 'pending' AND ${dispatchVisibility("$2")}
         ON CONFLICT (request_id, electrician_id) DO NOTHING
         RETURNING request_id`,
        [requestId, request.user.id],
      );
      if (declined.rowCount === 0) {
        const exists = await pool.query(`SELECT 1 FROM ${schema}.service_requests WHERE id = $1`, [requestId]);
        return sendError(response, exists.rowCount ? 409 : 404,
          exists.rowCount ? "This request is no longer available to you." : "Request not found.");
      }
      return response.json({ ok: true });
    }

    const allowedPrevious = status === "completed" ? "accepted" : "pending";
    const result = await pool.query(
      `UPDATE ${schema}.service_requests AS r
       SET status = $1,
           electrician_id = CASE WHEN $1 = 'accepted' THEN $4 ELSE electrician_id END,
           electrician_phone = CASE WHEN $1 = 'accepted' THEN $5 ELSE electrician_phone END,
           estimated_resolution = CASE WHEN $1 = 'accepted' THEN $6 ELSE estimated_resolution END,
           updated_at = NOW()
       WHERE r.id = $2 AND r.status = $3
         AND (($1 = 'completed' AND r.electrician_id = $4)
           OR ($1 = 'accepted' AND r.electrician_id IS NULL AND ${dispatchVisibility("$4")}))
       RETURNING r.id`,
      [status, request.params.id, allowedPrevious, request.user.id,
        status === "accepted" ? electricianPhone.trim() : null,
        status === "accepted" ? estimatedResolution.trim() : null],
    );
    if (result.rowCount === 0) {
      const exists = await pool.query(`SELECT 1 FROM ${schema}.service_requests WHERE id = $1`, [request.params.id]);
      return sendError(response, exists.rowCount ? 409 : 404,
        exists.rowCount ? "This request has already been updated." : "Request not found.");
    }

    const updated = await pool.query(
      `SELECT ${requestColumns}
       FROM ${schema}.service_requests r
       ${requestJoins}
       WHERE r.id = $1`,
      [request.params.id],
    );
    response.json({ request: mapRequest(updated.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/requests/:id/change-electrician", requireAuth("customer"), async (request, response, next) => {
  const requestId = request.params.id;
  if (!/^[1-9]\d{0,18}$/.test(requestId) || BigInt(requestId) > 9223372036854775807n) {
    return sendError(response, 400, "The request id is invalid.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, electrician_id
       FROM ${schema}.service_requests
       WHERE id = $1 AND customer_id = $2 AND status = 'accepted'
       FOR UPDATE`,
      [requestId, request.user.id],
    );
    if (current.rowCount === 0) {
      const exists = await client.query(
        `SELECT 1 FROM ${schema}.service_requests WHERE id = $1 AND customer_id = $2`,
        [requestId, request.user.id],
      );
      await client.query("ROLLBACK");
      return sendError(response, exists.rowCount ? 409 : 404,
        exists.rowCount ? "This request cannot be changed right now." : "Request not found.");
    }

    const assignedElectricianId = current.rows[0].electrician_id;
    if (assignedElectricianId) {
      await client.query(
        `INSERT INTO ${schema}.service_request_excluded_electricians (request_id, electrician_id)
         VALUES ($1, $2)
         ON CONFLICT (request_id, electrician_id) DO NOTHING`,
        [requestId, assignedElectricianId],
      );
    }
    await client.query(
      `UPDATE ${schema}.service_requests
       SET status = 'pending', electrician_id = NULL, electrician_phone = NULL,
           estimated_resolution = NULL, dispatch_started_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId],
    );
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/", (request, response) => response.sendFile(path.join(root, "index.html")));
app.get("/index.html", (request, response) => response.sendFile(path.join(root, "index.html")));
app.get("/app.js", (request, response) => response.type("application/javascript").sendFile(path.join(root, "app.js")));
app.get("/styles.css", (request, response) => response.type("text/css").sendFile(path.join(root, "styles.css")));
app.get("/favicon.ico", (request, response) => response.sendStatus(204));

app.use((request, response) => sendError(response, 404, "Not found."));
app.use((error, request, response, next) => {
  if (error.type === "entity.parse.failed") {
    return sendError(response, 400, "Request body must be valid JSON.");
  }
  if (error.type === "entity.too.large") {
    return sendError(response, 413, "Request body is too large.");
  }
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
