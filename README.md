# India IPO Lock-in Tracker

A **source-verified IPO lock-in date intelligence system** for Indian listed companies. Built for investment/research teams that need to monitor upcoming IPO lock-in expiries with full auditability: every date is backed by stored source evidence, cross-checked across independent sources, scored with an explainable confidence model, and **never invented** — if the system cannot establish a date, it says *Date unavailable / Needs Review*.

> Lock-in dates are compiled from publicly available regulatory filings, exchange disclosures, company documents, and other sources. Users should verify material investment decisions against the underlying primary documentation. The system does not constitute investment advice.

## Feature overview

- **Dashboard** — last sync time, data health, upcoming lock-ins, review alerts, prominent **↻ Sync Now** (browser refresh never triggers scraping)
- **Upcoming view** — expiries grouped into Next 7 / 30 / 60 / 90 days
- **Main table** — sortable/filterable lock-in events (company, exchange, category, status, confidence, date range, upcoming/expired) with global search and CSV/Excel export including source URLs
- **IPO detail** — the full research view: raw → calculated → published → override → final date audit trail, explainable confidence breakdown, per-source evidence snippets with *Open Source* links, discrepancy panels, analyst overrides and review notes
- **Verification engine** — cross-checks every event across sources, statuses: `VERIFIED`, `CROSS_CHECKED`, `PRIMARY_SOURCE_ONLY`, `SECONDARY_SOURCE_ONLY`, `DATE_DISCREPANCY`, `CALCULATION_REQUIRED`, `NEEDS_REVIEW`, `SOURCE_UNAVAILABLE`, `MANUALLY_VERIFIED`
- **Sync engine** — asynchronous, per-source error isolation (one failed source never stops the run), live progress, full sync history and error log
- **Source management** — configurable source hierarchy (Tier 1 regulatory → Tier 3 secondary), priorities editable in the UI, enable/disable without code changes
- **Authentication** — Viewer / Analyst / Admin roles

## Architecture

```text
Next.js 15 (App Router, TypeScript, Tailwind)
├── src/lib/engine/          Core engines (pure, unit-tested)
│   ├── dates.ts             Date calculation engine (configurable rules, audit records)
│   ├── verification.ts      Cross-checking engine + status assignment
│   ├── confidence.ts        Explainable confidence scoring (factor breakdown)
│   └── normalize.ts         Entity normalization, duplicate detection, Indian date parsing
├── src/lib/adapters/        Source adapter framework
│   ├── types.ts             SourceAdapter interface (discover / fetchLockIns)
│   ├── http.ts              Responsible HTTP client (robots.txt, backoff, cache, no anti-bot evasion)
│   ├── lockin-parser.ts     Contextual lock-in extraction from document text
│   ├── nse.ts, bse.ts       Live exchange adapters (Tier 1)
│   ├── sample.ts/-data.ts   Demo adapters (three fictional-source personas)
│   └── registry.ts          adapterKey → implementation mapping
├── src/lib/sync/            Sync engine (async pipeline + per-event verification)
├── src/lib/auth/            JWT session auth + role checks
├── src/app/api/             REST APIs
├── src/app/(app)/           Dashboard pages
└── prisma/                  PostgreSQL schema + seed
```

**Data-accuracy principles** (enforced in code, not just convention):

1. Raw, calculated, published, override and final values are stored separately — nothing is overwritten.
2. Disagreeing sources produce a visible `DATE_DISCREPANCY` with per-source dates, an explanation, the authoritative source and a recommended date — never a silent choice.
3. A calculated date that contradicts a published date flags the record for review.
4. Low-confidence extractions are discarded from cross-checking (kept as evidence) → `NEEDS_REVIEW`; "approximately 90 days" is never silently converted to an exact date.
5. Every verification pass appends an immutable `verification_results` row; manual overrides supersede (never delete) earlier ones.

## Local development

Prerequisites: Node 20+, PostgreSQL 14+.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env      # set DATABASE_URL and AUTH_SECRET

# 3. Create the database (example)
createdb ipo_lockin

# 4. Migrate + generate client
npx prisma migrate deploy
npx prisma generate

# 5. Seed users, sources and run the initial full sync
npm run db:seed

# 6. Run
npm run dev               # http://localhost:3000
```

### Demo accounts (created by the seed)

| Email | Default password | Role |
|---|---|---|
| admin@example.com | `admin-demo-123` | Admin — sync, manage sources, view logs |
| analyst@example.com | `analyst-demo-123` | Analyst — verify, override, add notes |
| viewer@example.com | `viewer-demo-123` | Viewer — read, search, filter, export |

Set `SEED_ADMIN_PASSWORD` / `SEED_ANALYST_PASSWORD` / `SEED_VIEWER_PASSWORD` before seeding in any real deployment.

### About the demo data

Live scraping requires network access to NSE/BSE, which many sandboxes (including CI) block; sources that deny automated access are marked **unavailable** — the system never bypasses anti-bot controls. So the seed populates the pipeline through three **clearly-labelled fictional demo sources** (fictional companies, badged `demo` throughout the UI and flagged in exports). They exercise every real code path: multi-source agreement, a deliberate one-day discrepancy, calculation-only dates, a low-confidence extraction, and expired events. Disable them on the Sources page once real sources are reachable in your deployment.

## Running things

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Production build / start | `npm run build` && `npm start` |
| Migrations | `npx prisma migrate deploy` (prod) / `npx prisma migrate dev` (dev) |
| Seed + initial sync | `npm run db:seed` |
| Manual sync (scraper) | **Sync Now** button, or `POST /api/sync` with an admin session |
| Tests | `npm test` |
| Lint / typecheck | `npm run lint` / `npm run typecheck` |

There is no separate worker process in the MVP: sync runs asynchronously inside the Next.js server (the API returns `202` immediately; the UI polls `/api/sync/status`). The `startSync()` entry point is trigger-agnostic (`MANUAL` / `SCHEDULED` / `API`), so moving it onto Redis + BullMQ or a cron is additive, not a redesign.

## API

```text
POST /api/auth/login | logout      GET /api/auth/me
GET  /api/ipos, /api/ipos/:id
GET  /api/lock-ins                 (q, exchange, category, status, window, minConfidence, from, to, sort, order, needsReview)
GET  /api/lock-ins/upcoming        (bucketed 7/30/60/90)
GET  /api/lock-ins/:id
POST /api/lock-ins/:id/verify      (Analyst+)
POST /api/lock-ins/:id/override    (Analyst+)
POST /api/lock-ins/:id/notes       (Analyst+)
GET  /api/sources                  PATCH /api/sources/:id (Admin)
POST /api/sync (Admin)             GET /api/sync/status, /api/sync/history
GET  /api/export?format=csv|xlsx   (same filters as /api/lock-ins)
```

All routes require an authenticated session (middleware-enforced); mutating routes additionally check roles. Input is validated with zod; queries go through Prisma (parameterized — no SQL injection); sessions are httpOnly/SameSite cookies; security headers are set in middleware.

## Adding a new source adapter

1. Implement `SourceAdapter` (`src/lib/adapters/types.ts`): `discover()` returns IPOs the source knows; `fetchLockIns()` returns per-IPO `LockInObservation`s, each carrying its own `SourceEvidence` (URL, title, snippet, parser confidence, retrieval timestamp). Throw `SourceUnavailableError` when blocked — never work around access controls.
2. Use `politeFetch()` from `adapters/http.ts` for HTTP (robots.txt, rate limiting, retries, caching are handled for you).
3. Register the adapter key in `src/lib/adapters/registry.ts`.
4. Insert a row in `sources` (name, domain, tier, priority, adapterKey) — via the seed or SQL. The Sources page manages priority/active state from then on.
5. Add fixture-based tests (see `tests/adapters.test.ts`) — unit tests must not depend on live websites.

## Deploying

Simplest production shape (single web service + managed Postgres):

```text
Railway / Render / Fly.io          Vercel
┌────────────────────────┐         ┌──────────────────┐
│  Next.js (web + sync)  │   or    │  Next.js         │ + external cron hitting POST /api/sync
│  POST /api/sync async  │         │  (serverless)*   │
└───────────┬────────────┘         └────────┬─────────┘
            │                               │
      Managed PostgreSQL (Railway/Render/Supabase/RDS)
```

1. Provision PostgreSQL; set `DATABASE_URL`, `AUTH_SECRET` (strong random), `SEED_*_PASSWORD`.
2. `npx prisma migrate deploy && npm run db:seed` (once).
3. `npm run build && npm start`.
4. Optional scheduled sync (e.g. daily 6:00 AM IST): platform cron calling `POST /api/sync` with an admin session, or a small worker using `startSync("SCHEDULED")`.

\* On serverless platforms, background work after the response is not guaranteed to complete; prefer a long-running host (Railway/Render/Fly/AWS ECS) for the sync process, or move sync into a queue worker (Redis + BullMQ — `REDIS_URL` is already in `.env.example`).

## Troubleshooting

- **`NSE India / BSE India — HTTP 403` in sync errors**: the exchange is refusing automated access from your network. This is expected behavior (the app does not evade anti-bot systems); the source is marked unavailable and other sources continue. Run from a network the source permits, or keep it disabled.
- **`AUTH_SECRET must be set`**: define it in `.env` (≥ 16 chars).
- **Login works but pages redirect to /login**: the `AUTH_SECRET` used by `middleware` and the server must match — restart after changing `.env`.
- **Stale dashboard after sync**: the UI refreshes when polling sees the run finish; a manual browser refresh re-reads the database only (never triggers scraping).
- **Prisma `P1001`**: PostgreSQL unreachable — check `DATABASE_URL` and that the server is running.
