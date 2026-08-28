# daily-tracker

Obsidian-style nested goals outliner (`/goals`) wired into a daily time-block
planner (`/today`). Next.js (App Router) + Prisma/Postgres + Tailwind v4,
styled with the "Block Style" token system in `app/globals.css`.

## Run

```bash
docker run -d --name daily-tracker-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=daily_tracker -p 5432:5432 postgres:16   # first run only
pnpm install
pnpm prisma migrate dev   # applies migrations to the docker DB
pnpm dev                  # http://localhost:3000 → /goals
```

`.env` points at the docker Postgres (`DATABASE_URL` /
`DATABASE_URL_UNPOOLED`, same URL locally — the split matters only for
Neon-style pooled production setups).

## Verify

```bash
pnpm test    # vitest — tree/keyboard/fuzzy pure-logic suite
pnpm lint
pnpm build   # also runs prisma generate + migrate deploy, like Vercel does
```

## Deploy (Vercel + Neon)

1. Push to GitHub, import the repo at vercel.com (Next.js + pnpm auto-detected).
2. Add the **Neon** integration (Vercel Marketplace) — it injects
   `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used by
   `prisma migrate deploy` during the build).
3. Set env vars `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` — `proxy.ts`
   gates the whole site with Basic Auth when both are set (unset locally,
   so dev stays open). Also set `TZ=Africa/Lagos`: date keys are
   server-local (`lib/date-key.ts`) and serverless defaults to UTC.
4. Deploy. Migrations apply automatically via the `build` script.

## Notes

- Single-user app: `lib/auth.ts` stubs `getUserId()`; the schema is
  multi-tenant-ready (`userId` on every row, every query scoped). Basic
  Auth in `proxy.ts` is the outer door, not per-user auth.
- `/today` shows 06:00–23:00 blocks; `#` in a task input links a leaf goal.
- Skills config for the engineering skills lives in `docs/agents/`
  (issue tracker: local markdown under `.scratch/`).
