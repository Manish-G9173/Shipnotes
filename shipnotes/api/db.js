const { Pool } = require('pg');

// Zerops injects PostgreSQL connection details as env vars on the
// "database" service. hstDb / port / user / pass / dbName are the
// standard Zerops PostgreSQL env var names.
const pool = new Pool({
  host: process.env.db_hostname || process.env.DB_HOST || 'database',
  port: process.env.db_port || process.env.DB_PORT || 5432,
  user: process.env.db_user || process.env.DB_USER || 'db',
  password: process.env.db_password || process.env.DB_PASSWORD,
  database: process.env.db_dbName || process.env.DB_NAME || 'db',
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS changelog_runs (
      id UUID PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      commit_count INT DEFAULT 0,
      changelog JSONB,
      announcement TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, initSchema };
