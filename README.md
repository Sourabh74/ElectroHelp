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

## Free demo deployment

This is a free-tier demo setup, not production hosting. Free hosting can sleep, pause, or have limited storage; check the provider's current limits before deploying.

1. Push the project to a GitHub repository. Confirm `.env` is ignored by Git and do not push it.
2. Create a free PostgreSQL project on [Supabase](https://supabase.com/). In its **Connect** dialog, choose **Session pooler** and copy the host, port, database, and username from the connection details. Set a strong database password.
3. In Supabase's SQL editor, run `server/schema.sql` after replacing both occurrences of `__SCHEMA__` with `"electrician"`. This creates the application tables without needing the deployed server to have schema-creation privileges.
4. Create a free **Web Service** on [Render](https://render.com/) and connect the GitHub repository. Use these settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/api/health`
   - **Plan:** Free
5. In the Render service's **Environment** settings, add the database connection values from Supabase:
   - `DB_HOST`: the session-pooler host shown by Supabase
   - `DB_PORT`: the session-pooler port shown by Supabase
   - `DB_NAME`: the database name shown by Supabase
   - `DB_USER`: the session-pooler username shown by Supabase
   - `DB_PASSWORD`: your Supabase database password
   - `DB_SCHEMA`: `electrician`
   - `DB_SSL`: `true`
   - `NODE_ENV`: `production`
   - `PORT` is supplied by Render; do not set it manually.
6. Save the variables and deploy. Open the Render URL and check that `/api/health` returns `{"status":"ok","database":"connected"}`.

Use the exact Supabase pooler values from its dashboard; the pooler username is different from the local `postgres` user. Free Render web services sleep after inactivity; free Supabase projects can pause after a week of inactivity and have a 500 MB database limit. Render's free PostgreSQL database expires after 30 days, so this guide uses Supabase for the database instead.
