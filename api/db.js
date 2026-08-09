const { Pool } = require('pg');

// DATABASE_URL is mapped in zerops.yml from the "database" service's
// auto-generated connectionString variable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
