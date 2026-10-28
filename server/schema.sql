CREATE TABLE IF NOT EXISTS app_state (
 id integer PRIMARY KEY CHECK (id=1), revision integer NOT NULL DEFAULT 1,
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, username text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('mentee','mentor','coord')),
 unit_id text, team integer, active boolean NOT NULL DEFAULT true,
 must_change boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role='mentee' AND unit_id IS NOT NULL) OR (role='mentor' AND team IS NOT NULL) OR role='coord')
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id),
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
 id text PRIMARY KEY, unit_id text NOT NULL, account_id text NOT NULL REFERENCES accounts(id),
 name text NOT NULL, mime text NOT NULL, size integer NOT NULL CHECK(size>0),
 digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_unit ON files(unit_id);
CREATE TABLE IF NOT EXISTS audit (
 id text PRIMARY KEY, account_id text REFERENCES accounts(id), action text NOT NULL,
 resource text NOT NULL, revision integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at);
