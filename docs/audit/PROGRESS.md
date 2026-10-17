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

- [x] **FK bugs.** (migration 0023, `a1adb30`/`52074a0`) `logs.friendly_id → devices.friendly_id` has no `ON DELETE/UPDATE` action, so
  deleting a device that has logs fails, renaming its friendly ID fails, and deleting a *user* whose
  devices have logs fails (cascade is blocked). `devices.playlist_id` and `devices.mixup_id` have no
  `ON DELETE` action, so deleting a playlist/mixup that is assigned to any device fails.
- [~] **Missing indexes.** (0023 adds logs + playlist_items indexes; claim pruning still open) `logs` has none (device-log pages filter by `friendly_id` and sort by
  `created_at`; retention deletes by `created_at`). `playlist_items(playlist_id, order_index)` is
  read on every playlist-mode display request. `pending_device_claims` grows without bound.
- [x] **Migrations only run from the UI.** (`lib/database/migrate.ts`, `AUTO_MIGRATE`) Extract the runner into `lib/database/migrate.ts` (on the
  existing `pg` driver, removing the second `postgres` driver), serialize concurrent runs with an
  advisory lock, and allow `AUTO_MIGRATE=true` at boot (Docker).
- [x] **Firmware OTA is forced on every device.** (`FIRMWARE_UPDATES=off`) `/api/display` advertises the latest official
  firmware to any device that reports an older version. DIY kits and other boards can be offered an
  image for different hardware. Add `FIRMWARE_UPDATES=auto|off`.
- [ ] **Registry snapshots are written into the source tree** (`data/trmnl/*.json`) at runtime,
  dirtying git checkouts. Write refreshed copies to a cache directory instead.
- [ ] **No health endpoint / container healthcheck.**
- [x] **Logger drops error details**: `metadata: { error }` serialises `Error` as `{}`.

### Performance

- [x] **RLS scoping costs 5 round trips per scoped operation** (`SET ROLE`, `set_config`, query,
  `set_config` reset, `RESET ROLE`). Combine setup and teardown into one statement each.
- [x] **Display hot path** resolves the device owner and then re-reads the same device in a second
  scoped session; each step pays the scoping overhead. Read the device row once.
- [x] **Every app page load counts and DISTINCTs `system_logs`** (`getInitData`) even though no page
  uses `totalLogs`, `uniqueSources` or `mixups` from it. Remove the unused queries.
- [x] **Each device request writes 2–4 `system_logs` rows** synchronously-ish (one INSERT per
  call). Batch writes and drop redundant per-request info rows.

### Security / abuse resistance

- [x] **`byos_app` was a LOGIN role with the public password `byos_app_password`** (0009). With
  Postgres reachable (docker-compose publishes 5432 on all interfaces) anyone could log in and set
  `app.current_user_id` to any tenant, or read sessions. 0024 makes it NOLOGIN and revokes auth-table
  access. Still open: bind the compose Postgres port to localhost.

- [ ] **Liquid templates run without limits** (`renderLimit`, `parseLimit`, `memoryLimit`), both for
  installed recipes and `/api/markup`.
- [x] **`POST /api/log` reads unbounded bodies**; cap size and entry count.
- [ ] **Unauthenticated `/api/display` calls with random tokens create unbounded
  `pending_device_claims` rows**; expire and prune them.
- [ ] **Session-protected API routes redirect to `/sign-in` (HTML)** instead of returning 401 JSON.
- [ ] **No startup validation of required configuration** (e.g. `BETTER_AUTH_SECRET` when auth is
  enabled — better-auth falls back to a default secret).

### Found during the work

- [x] Devices added by API key from the UI have `screen = NULL`; `/api/display` threw for them on
  every wake-up. Now falls back to the default screen.
- [x] Malformed `RSSI`/`Battery-Voltage` headers wrote NaN and failed playlist-mode requests.
- [x] pg pool had no `error` listener: an idle connection dropped by the server crashed the process.

### Maintainability

- [x] `findOrCreateDevice` duplicates the API-key and MAC branches almost line for line.
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

- After `a1adb30`: 183 unit tests, 13 Postgres integration tests (`pnpm test:db`), tsc and Biome clean;
  production build OK. Standalone server (localhost only) against a fresh Postgres with
  `AUTO_MIGRATE=true`: migrations 0000–0024 applied at boot; simulated device setup → display →
  image (1-bit PNG) → log upload → display; playlist rotation persisted `current_playlist_index`;
  deleting an in-use playlist succeeded and the device got the "Playlist mode needs a playlist" image.
  Warm `/api/display` ≈ 22 ms locally.
