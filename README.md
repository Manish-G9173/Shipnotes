[README.md](https://github.com/user-attachments/files/30868367/README.md)
# Shipnotes

Paste a public GitHub repo. Get a real changelog, generated from its actual recent commits — not a mock, not a placeholder.

**Live demo:** _add your live Zerops URL here_
**Built for:** The Zerops Challenge, WeMakeDevs × Zerops, Aug 2026

---

## What it does

Writing release notes is a real, recurring chore every maintainer puts off. Shipnotes removes the busywork:

1. Paste a public repo (`owner/repo` or a GitHub URL) — or click one of the preset chips for an instant example
2. The app fetches the repo's real recent commits via GitHub's public API
3. Commits are grouped into **Features**, **Fixes**, and **Breaking changes**, with a short plain-English release announcement
4. The result is saved and versioned, so past runs stay browsable

No login. No signup. Paste a repo, watch it work.

---

## Architecture

```
                    ┌─────────────┐
    judge's browser │  frontend   │  static UI, live job status
                    └──────┬──────┘
                           │ HTTP
                    ┌──────▼──────┐
                    │     api     │  validates + queues jobs
                    └───┬─────┬───┘
                        │     │
              ┌─────────▼┐   ┌▼──────────┐
              │  cache   │   │  worker   │  fetches GitHub data,
              │ (Valkey) │◄──┤           │  runs AI categorization
              └──────────┘   └─────┬─────┘
                                   │
                             ┌─────▼─────┐
                             │  database  │  versioned changelog runs
                             │(PostgreSQL)│
                             └───────────┘
```

- **frontend** — static HTML/CSS/JS served by a small Node process. No build step, so deploys stay reliable.
- **api** — Express service. Validates the repo input, writes a `queued` job row to Postgres, pushes the job onto a Valkey list acting as a queue.
- **worker** — pulls jobs off the Valkey queue, fetches real commits from GitHub's public API, caches the raw commit data in Valkey (avoids re-fetching the same repo on repeat runs), calls an AI model to categorize commits and draft the announcement, writes the result back to Postgres.
- **database** — PostgreSQL. One row per run: repo, status, categorized changelog, announcement, timestamp. This is what makes runs versioned and browsable, not just one-shot.
- **cache** — Valkey, doing double duty: as the job queue (`LPUSH`/`BRPOP`) between api and worker, and as a fetch cache for repo commit data.

## How Zerops is used

This isn't a single container with Zerops as a host — five services genuinely depend on each other over Zerops's private network:

- The async job lifecycle (`queued → fetching → categorizing → done`) only exists because `worker` is a separate long-running process from `api`, talking over the private network
- Valkey is load-bearing twice over: queue transport and cache, not decoration
- Postgres gives us real persistence — refreshing the page doesn't lose anything, and old runs stay queryable
- Every service was deployed straight from this GitHub repo via Zerops's Git-connected pipeline, with per-service `zerops.yaml` configs pointing at each subfolder

## What we learned

- Building the async pipeline first (queue → worker → status polling) before touching the UI made the whole thing much easier to debug — you can watch a job's status change directly in the database
- A heuristic fallback categorizer (conventional-commit-style keyword matching) turned out to be a good safety net — the app produces a real result even if the AI call fails or an API key isn't configured, so a demo never breaks on a flaky external call
- Caching fetched commit data meant repeat demos of the same repo (e.g. clicking a preset chip twice) come back near-instantly, which matters a lot for a live judged demo

## Running locally

Each service needs its own `npm install` and expects Postgres + Valkey reachable via env vars (`db_hostname`, `cache_hostname`, etc. — see `db.js` / `worker.js` for the full list). In production these are injected automatically by Zerops.

```bash
cd api && npm install && npm start
cd worker && npm install && npm start
cd frontend && npm install && npm start
```

## Screenshots

_Add screenshots of the live UI here before submitting._
