const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');
const { pool, initSchema } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Zerops injects Valkey/Redis connection details on the "cache" service.
const redisUrl = process.env.cache_connectionString ||
  `redis://${process.env.cache_hostname || process.env.REDIS_HOST || 'cache'}:${process.env.cache_port || process.env.REDIS_PORT || 6379}`;

const redis = createClient({ url: redisUrl });
redis.on('error', (err) => console.error('Redis error', err));

const PRESET_REPOS = [
  { owner: 'expressjs', name: 'express', label: 'Express' },
  { owner: 'facebook', name: 'react', label: 'React' },
  { owner: 'vuejs', name: 'core', label: 'Vue' },
  { owner: 'vercel', name: 'next.js', label: 'Next.js' },
];

function parseRepoUrl(input) {
  const trimmed = input.trim();
  // Accept "owner/repo" or a full github.com URL
  const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shortMatch) return { owner: shortMatch[1], name: shortMatch[2] };

  const urlMatch = trimmed.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (urlMatch) return { owner: urlMatch[1], name: urlMatch[2].replace(/\.git$/, '') };

  return null;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/presets', (req, res) => res.json(PRESET_REPOS));

app.post('/api/jobs', async (req, res) => {
  try {
    const repo = parseRepoUrl(req.body.repo || '');
    if (!repo) {
      return res.status(400).json({ error: 'Enter a valid GitHub repo, like owner/repo or a github.com URL.' });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO changelog_runs (id, repo_owner, repo_name, status) VALUES ($1, $2, $3, 'queued')`,
      [id, repo.owner, repo.name]
    );

    await redis.lPush('shipnotes:jobs', JSON.stringify({ id, owner: repo.owner, name: repo.name }));

    res.json({ id, status: 'queued' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not queue the job.' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM changelog_runs WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, repo_owner, repo_name, status, commit_count, created_at FROM changelog_runs ORDER BY created_at DESC LIMIT 20'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'History lookup failed.' });
  }
});

async function start() {
  await initSchema();
  await redis.connect();
  app.listen(PORT, () => console.log(`api listening on ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start api service', err);
  process.exit(1);
});
