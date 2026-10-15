const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const nodeEnv = process.env.NODE_ENV || "development";
const connectionString = process.env.DATABASE_URL?.trim();
const requiredDatabaseSettings = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const missingDatabaseSettings = requiredDatabaseSettings.filter((key) => !process.env[key]);

if (!connectionString && missingDatabaseSettings.length > 0) {
  throw new Error(
    `Database configuration is missing. Set DATABASE_URL (recommended on Render), ` +
    `or set all of ${requiredDatabaseSettings.join(", ")}. Missing: ${missingDatabaseSettings.join(", ")}.`,
  );
}

if (connectionString) {
  let parsedConnectionString;
  try {
    parsedConnectionString = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsedConnectionString.protocol) ||
      !parsedConnectionString.hostname || !parsedConnectionString.pathname.slice(1)) {
    throw new Error("DATABASE_URL must include a PostgreSQL protocol, host, and database name.");
  }
}

const port = Number(process.env.PORT || 3000);
const dbPort = Number(process.env.DB_PORT || 5432);
const schema = process.env.DB_SCHEMA || "electrician";
const sslSetting = process.env.DB_SSL?.toLowerCase();
const sslCa = process.env.DB_SSL_CA?.trim();
const sslCaFile = process.env.DB_SSL_CA_FILE?.trim();

if (sslSetting && !["true", "false"].includes(sslSetting)) {
  throw new Error("DB_SSL must be set to true or false.");
}

if (sslCa && sslCaFile) {
  throw new Error("Set either DB_SSL_CA or DB_SSL_CA_FILE, not both.");
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error("DB_PORT must be a valid TCP port.");
}

if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
  throw new Error("DB_SCHEMA must be a valid PostgreSQL schema identifier.");
}

module.exports = {
  port,
  nodeEnv,
  database: {
    connectionString,
    host: process.env.DB_HOST,
    port: dbPort,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: sslSetting === "true" || (!sslSetting && nodeEnv === "production")
      ? {
        rejectUnauthorized: true,
        ...(sslCa ? { ca: sslCa } : sslCaFile ? { ca: fs.readFileSync(sslCaFile, "utf8") } : {}),
      }
      : undefined,
    schema,
  },
  email: {
    otpSecret: process.env.EMAIL_OTP_SECRET?.trim(),
    resendApiKey: process.env.RESEND_API_KEY?.trim(),
    from: process.env.EMAIL_FROM?.trim(),
  },
};
