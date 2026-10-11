const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({
  connectionString: config.database.connectionString,
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function initializeDatabase() {
  const schema = quoteIdentifier(config.database.schema);
  const schemaSql = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schemaSql.replaceAll("__SCHEMA__", schema));
}

module.exports = { pool, initializeDatabase };
