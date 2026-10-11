# Current electrician requests

The website uses a local PostgreSQL database in the `electrician` schema. Configure the database connection in the root `.env` file; `.env.example` lists the required settings without credentials.

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Confirm PostgreSQL is running and the configured database user can create a schema and tables in the configured database.
3. Run `npm install`.
4. Review the database settings in `.env`.
5. Run `npm run db:init` to create the schema and tables, or skip this step because `npm start` initializes them automatically.
6. Run `npm start` and open <http://localhost:3000>.

The `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` settings correspond to the PostgreSQL server connection. `DB_SCHEMA` chooses the PostgreSQL schema that contains the app tables.

## Database tables

- `electrician.accounts` stores customer and electrician accounts, with scrypt password hashes.
- `electrician.sessions` stores hashed session tokens and expiration times.
- `electrician.service_requests` stores repair details, customer ownership, and request status.

The API enforces account types: customers can create and view their own requests; electricians can review incoming requests and accept, decline, or complete them.

Keep `.env` private and do not commit database credentials. The included credentials are for local development only; use a dedicated, least-privileged database account for any shared or deployed environment.
