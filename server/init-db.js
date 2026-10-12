const { initializeDatabase, pool } = require("./db");

initializeDatabase()
  .then(() => {
    console.log("Electrician PostgreSQL schema is ready.");
  })
  .catch((error) => {
    console.error("Could not initialize the electrician PostgreSQL schema:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
