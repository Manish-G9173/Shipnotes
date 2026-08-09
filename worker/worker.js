const { Pool } = require('pg');
const { createClient } = require('redis');
const fetch = require('node-fetch');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => console.error('Redis error', err));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

async function setStatus(id, status, extra = {}) {
  const fields = Object.keys(extra);
  const setClause = ['status = $2', ...fields.map((f, i) => `${f} = $${i + 3}`)].join(', ');
  await pool.query(
    `UPDATE changelog_runs SET ${setClause} WHERE id = $1`,
    [id, status, ...fields.map((f) => extra[f])]
  );
}

async function fetchCommits(owner, name) {
  const cacheKey = `repo:${owner}/${name}:commits`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const headers = { 'User-Agent': 'shipnotes-app' };
  if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

  const url = `https://api.github.com/repos/${owner}/${name}/commits?per_page=30`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`GitHub API error ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();

  const commits = data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author?.name || 'unknown',
    date: c.commit.author?.date,
  }));

  await redis.set(cacheKey, JSON.stringify(commits), { EX: 300 });
  return commits;
}

// Heuristic fallback categorizer, used if no OPENROUTER_API_KEY is set,
// or if the AI call fails, so the app always produces a real result.
function heuristicCategorize(commits) {
  const features = [];
  const fixes = [];
  const breaking = [];
  const other = [];

  for (const c of commits) {
    const m = c.message.toLowerCase();
    if (m.includes('breaking') || m.startsWith('feat!') || m.includes('!:')) {
      breaking.push(c.message);
    } else if (m.startsWith('feat') || m.includes('add ') || m.includes('new ')) {
      features.push(c.message);
    } else if (m.startsWith('fix') || m.includes('bug') || m.includes('patch')) {
      fixes.push(c.message);
    } else {
      other.push(c.message);
    }
  }

  return { features, fixes, breaking, other };
}

async function aiCategorize(owner, name, commits) {
  if (!OPENROUTER_API_KEY) return null;

  const commitList = commits.map((c) => `- ${c.message}`).join('\n');
  const prompt = `You are categorizing real git commits from the repo ${owner}/${name} into a changelog.
Group them into: features, fixes, breaking (breaking changes), other.
Also write a 1-2 sentence release announcement in a friendly, plain-English tone.

Commits:
${commitList}

Respond ONLY with JSON in this exact shape, no markdown fences, no extra text:
{"features": ["..."], "fixes": ["..."], "breaking": ["..."], "other": ["..."], "announcement": "..."}`;

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`OpenRouter error ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('AI categorize failed, falling back to heuristic:', err.message);
    return null;
  }
}

async function processJob(job) {
  const { id, owner, name } = job;
  console.log(`Processing ${owner}/${name} (${id})`);

  try {
    await setStatus(id, 'fetching');
    const commits = await fetchCommits(owner, name);

    await setStatus(id, 'categorizing', { commit_count: commits.length });

    let result = await aiCategorize(owner, name, commits);
    if (!result) {
      const heuristic = heuristicCategorize(commits);
      result = {
        ...heuristic,
        announcement: `${commits.length} commits landed in ${owner}/${name} recently, spanning ${heuristic.features.length} feature-flavored changes and ${heuristic.fixes.length} fixes.`,
      };
    }

    const changelog = {
      features: result.features || [],
      fixes: result.fixes || [],
      breaking: result.breaking || [],
      other: result.other || [],
    };

    await setStatus(id, 'done', {
      changelog: JSON.stringify(changelog),
      announcement: result.announcement || '',
    });
    console.log(`Done ${owner}/${name}`);
  } catch (err) {
    console.error(`Job ${id} failed:`, err.message);
    await setStatus(id, 'error', { error: err.message });
  }
}

async function loop() {
  while (true) {
    try {
      const item = await redis.brPop('shipnotes:jobs', 5);
      if (item) {
        const job = JSON.parse(item.element);
        await processJob(job);
      }
    } catch (err) {
      console.error('Worker loop error:', err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function start() {
  await redis.connect();
  console.log('Worker started, waiting for jobs...');
  await loop();
}

start().catch((err) => {
  console.error('Failed to start worker', err);
  process.exit(1);
});
