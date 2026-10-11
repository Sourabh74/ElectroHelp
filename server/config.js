const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SCHEMA"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environments setting: ${key}`);
  }
}

const port = Number(process.env.PORT || 3000);
const dbPort = Number(process.env.DB_PORT || 5432);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error("DB_PORT must be a valid TCP port.");
}

if (!/^[a-z_][a-z0-9_]*$/i.test(process.env.DB_SCHEMA)) {
  throw new Error("DB_SCHEMA must be a valid PostgreSQL schema identifier.");
}

module.exports = {
  port,
  nodeEnv: process.env.NODE_ENV || "development",
  database: {
    host: process.env.DB_HOST,
    port: dbPort,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    schema: process.env.DB_SCHEMA,
  },
};
