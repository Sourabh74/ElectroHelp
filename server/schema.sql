CREATE SCHEMA IF NOT EXISTS __SCHEMA__;

CREATE TABLE IF NOT EXISTS __SCHEMA__.accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  account_type VARCHAR(16) NOT NULL CHECK (account_type IN ('customer', 'electrician')),
  password_salt BYTEA NOT NULL,
  password_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.sessions (
  token_hash BYTEA PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES __SCHEMA__.accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
  ON __SCHEMA__.sessions (expires_at);

CREATE TABLE IF NOT EXISTS __SCHEMA__.service_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES __SCHEMA__.accounts(id) ON DELETE CASCADE,
  electrician_id BIGINT REFERENCES __SCHEMA__.accounts(id) ON DELETE SET NULL,
  issue VARCHAR(120) NOT NULL,
  location VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  electrician_phone VARCHAR(30),
  estimated_resolution VARCHAR(100),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE __SCHEMA__.service_requests
  ADD COLUMN IF NOT EXISTS electrician_id BIGINT REFERENCES __SCHEMA__.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS electrician_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS estimated_resolution VARCHAR(100);

CREATE TABLE IF NOT EXISTS __SCHEMA__.service_request_excluded_electricians (
  request_id BIGINT NOT NULL REFERENCES __SCHEMA__.service_requests(id) ON DELETE CASCADE,
  electrician_id BIGINT NOT NULL REFERENCES __SCHEMA__.accounts(id) ON DELETE CASCADE,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, electrician_id)
);

CREATE INDEX IF NOT EXISTS service_requests_customer_created_idx
  ON __SCHEMA__.service_requests (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS service_requests_status_created_idx
  ON __SCHEMA__.service_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS service_requests_electrician_status_idx
  ON __SCHEMA__.service_requests (electrician_id, status);
