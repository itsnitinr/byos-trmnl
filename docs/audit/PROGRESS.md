# Full audit — progress log

Branch: `claude/full-audit` (git worktree at `../byos-trmnl-audit`, created from `main` @ `518e082`).
The `main` checkout had uncommitted sun-path recipe work; it was intentionally left untouched.

This file is the hand-off point for any agent continuing the audit. Keep it current:
tick items as they land, add a line to the validation log, and record decisions.

## How to resume

```bash
cd ../byos-trmnl-audit          # or: git worktree list
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
# Integration tests need a throwaway Postgres (never point at real data):
docker run -d --name byos-audit-pg -e POSTGRES_PASSWORD=audit -e POSTGRES_DB=byos_db \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:audit@127.0.0.1:55432/byos_db?sslmode=disable pnpm test:db
```

Conventions: Biome (tabs, double quotes), small focused commits (`type: summary`),
one commit per finding where practical. Run `pnpm generate:sql` after adding a migration.

## Baseline (before any change)

- Jest: 32 suites / 172 tests pass (Node 24.21.0; repo pins 22.22.3).
- `tsc --noEmit` and `biome check` clean.
- `pnpm build` succeeds in ~50 s; standalone output includes `data/trmnl/*.json`.

## Findings and plan

Status: `[x]` done, `[~]` partially done / follow-up noted, `[ ]` open.

### Correctness and reliability

- [ ] **FK bugs.** `logs.friendly_id → devices.friendly_id` has no `ON DELETE/UPDATE` action, so
  deleting a device that has logs fails, renaming its friendly ID fails, and deleting a *user* whose
  devices have logs fails (cascade is blocked). `devices.playlist_id` and `devices.mixup_id` have no
  `ON DELETE` action, so deleting a playlist/mixup that is assigned to any device fails.
- [ ] **Missing indexes.** `logs` has none (device-log pages filter by `friendly_id` and sort by
  `created_at`; retention deletes by `created_at`). `playlist_items(playlist_id, order_index)` is
  read on every playlist-mode display request. `pending_device_claims` grows without bound.
- [ ] **Migrations only run from the UI.** Extract the runner into `lib/database/migrate.ts` (on the
  existing `pg` driver, removing the second `postgres` driver), serialize concurrent runs with an
  advisory lock, and allow `AUTO_MIGRATE=true` at boot (Docker).
- [ ] **Firmware OTA is forced on every device.** `/api/display` advertises the latest official
  firmware to any device that reports an older version. DIY kits and other boards can be offered an
  image for different hardware. Add `FIRMWARE_UPDATES=auto|off`.
- [ ] **Registry snapshots are written into the source tree** (`data/trmnl/*.json`) at runtime,
  dirtying git checkouts. Write refreshed copies to a cache directory instead.
- [ ] **No health endpoint / container healthcheck.**
- [ ] **Logger drops error details**: `metadata: { error }` serialises `Error` as `{}`.

### Performance

- [ ] **RLS scoping costs 5 round trips per scoped operation** (`SET ROLE`, `set_config`, query,
  `set_config` reset, `RESET ROLE`). Combine setup and teardown into one statement each.
- [ ] **Display hot path** resolves the device owner and then re-reads the same device in a second
  scoped session; each step pays the scoping overhead. Read the device row once.
- [ ] **Every app page load counts and DISTINCTs `system_logs`** (`getInitData`) even though no page
  uses `totalLogs`, `uniqueSources` or `mixups` from it. Remove the unused queries.
- [ ] **Each device request writes 2–4 `system_logs` rows** synchronously-ish (one INSERT per
  call). Batch writes and drop redundant per-request info rows.

### Security / abuse resistance

- [ ] **Liquid templates run without limits** (`renderLimit`, `parseLimit`, `memoryLimit`), both for
  installed recipes and `/api/markup`.
- [ ] **`POST /api/log` reads unbounded bodies**; cap size and entry count.
- [ ] **Unauthenticated `/api/display` calls with random tokens create unbounded
  `pending_device_claims` rows**; expire and prune them.
- [ ] **Session-protected API routes redirect to `/sign-in` (HTML)** instead of returning 401 JSON.
- [ ] **No startup validation of required configuration** (e.g. `BETTER_AUTH_SECRET` when auth is
  enabled — better-auth falls back to a default secret).

### Maintainability

- [ ] `findOrCreateDevice` duplicates the API-key and MAC branches almost line for line.
- [ ] Server actions accept unvalidated input (`updateDevice`, playlist saves).
- [ ] Recipe data-refresh defaults live in a slug-keyed map far from the recipes.
- [ ] Dead code: `cache-handler.js` (not wired into `next.config.ts`), duplicated filter builders in
  log actions.
- [ ] README links to a non-existent `app/recipes/README.md`.
- [ ] CI does not run a production build or database integration tests.

## Decisions

- Work in a separate worktree to keep the user's uncommitted `main` changes intact.
- Prefer additive, idempotent migrations (`0023+`); never edit applied migrations (their checksums
  are recorded in `schema_migrations`).

## Validation log

- (pending)
