# Full audit — progress log

Branch: `claude/full-audit` (git worktree at `../byos-trmnl-audit`, created from `main` @ `518e082`).
The `main` checkout had uncommitted sun-path recipe work; it was intentionally left untouched.

This file is the hand-off point for any agent continuing the audit. Keep it current:
tick items as they land, add a line to the validation log, and record decisions.

**Status (2026-10-18):** all planned items are done and validated; remaining ideas are listed under
"Open / ideas not done". The branch has not been pushed or merged.

## Upgrade notes for an existing installation

- Apply migrations 0023 (FK actions + indexes; builds indexes on `logs`, which can take a moment
  on a large table) and 0024 (`byos_app` → NOLOGIN, no access to auth tables). Use the setup
  screen or `AUTO_MIGRATE=true`. 0024 only warns if the connecting role may not alter `byos_app`.
- New optional settings: `AUTO_MIGRATE`, `FIRMWARE_UPDATES` (set `off` for DIY kits on custom
  firmware), `LOG_DB_LEVEL`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_SSL`,
  `TRMNL_REGISTRY_CACHE_DIR`, `RESEND_API_KEY`/`EMAIL_FROM` (documented, previously undocumented).
- Behaviour changes: unauthenticated API calls get 401 JSON (pages still redirect); pending device
  claims expire after 24 h; display responses include `image_url_timeout: 30`; refresh intervals are
  clamped to 1 s–24 h; devices count as offline only after a grace period.

## How to resume

```bash
cd ../byos-trmnl-audit          # or: git worktree list
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
# Integration tests need a throwaway Postgres (never point at real data):
docker run -d --name byos-audit-pg -e POSTGRES_PASSWORD=audit -e POSTGRES_DB=byos_db \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
docker exec byos-audit-pg psql -U postgres -c "CREATE DATABASE byos_test"
TEST_DATABASE_URL=postgres://postgres:audit@127.0.0.1:55432/byos_test?sslmode=disable pnpm test:db
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

- [x] **FK bugs.** (migration 0023, `52074a0`) `logs.friendly_id → devices.friendly_id` has no `ON DELETE/UPDATE` action, so
  deleting a device that has logs fails, renaming its friendly ID fails, and deleting a *user* whose
  devices have logs fails (cascade is blocked). `devices.playlist_id` and `devices.mixup_id` have no
  `ON DELETE` action, so deleting a playlist/mixup that is assigned to any device fails.
- [x] **Missing indexes / unbounded tables.** (0023 indexes; claims expire + hourly pruning `0fa2870`) `logs` has none (device-log pages filter by `friendly_id` and sort by
  `created_at`; retention deletes by `created_at`). `playlist_items(playlist_id, order_index)` is
  read on every playlist-mode display request. `pending_device_claims` grows without bound.
- [x] **Migrations only run from the UI.** (`lib/database/migrate.ts`, `AUTO_MIGRATE`) Extract the runner into `lib/database/migrate.ts` (on the
  existing `pg` driver, removing the second `postgres` driver), serialize concurrent runs with an
  advisory lock, and allow `AUTO_MIGRATE=true` at boot (Docker).
- [x] **Firmware OTA is forced on every device.** (`FIRMWARE_UPDATES=off`) `/api/display` advertises the latest official
  firmware to any device that reports an older version. DIY kits and other boards can be offered an
  image for different hardware. Add `FIRMWARE_UPDATES=auto|off`.
- [x] **Registry snapshots are written into the source tree** (`data/trmnl/*.json`) at runtime,
  dirtying git checkouts. Write refreshed copies to a cache directory instead.
- [x] **No health endpoint / container healthcheck.** (`/api/health`, Docker HEALTHCHECK)
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
  access. Compose now publishes Postgres on 127.0.0.1 only.

- [x] **Liquid templates run without limits** (`renderLimit`, `parseLimit`, `memoryLimit`), both for
  installed recipes and `/api/markup`.
- [x] **`POST /api/log` reads unbounded bodies**; cap size and entry count.
- [x] **Unauthenticated `/api/display` calls with random tokens create unbounded
  `pending_device_claims` rows**; expire and prune them.
- [x] **Session-protected API routes redirect to `/sign-in` (HTML)** instead of returning 401 JSON.
- [x] **No startup validation of required configuration** (`lib/config.ts`) (e.g. `BETTER_AUTH_SECRET` when auth is
  enabled — better-auth falls back to a default secret).

### Found during the work

- [x] Devices added by API key from the UI have `screen = NULL`; `/api/display` threw for them on
  every wake-up. Now falls back to the default screen.
- [x] Malformed `RSSI`/`Battery-Voltage` headers wrote NaN and failed playlist-mode requests.
- [x] pg pool had no `error` listener: an idle connection dropped by the server crashed the process.
- [x] UI "None" playlist/mixup sent `''` into a UUID column → device save failed.
- [x] Default refresh rate saved as a string → schedule silently ignored (180 s fallback).
- [x] `/api/playlists/items` returned `parseInt(uuid)` ids.
- [x] Device-page system-log search ORed with the device filter (widened results); device filter
  matched a key the routes never write; LIKE wildcards in search unescaped.
- [x] Chrome pool's SIGTERM handler called `process.exit(0)`, killing in-flight requests on every
  restart (reproduced: curl "empty reply" 0.3 s after SIGTERM; fixed build drains a 5 s request).
- [x] `/api/log` documented body shape was wrong; invalid JSON returned 500.
- [x] Unused deps (18 `@radix-ui/react-*`, satori, jimp, zustand, …) and ESLint leftovers removed.
- [x] `data:image/svg+xml;utf8,…` URLs (air-quality, sunrise-sunset, Graph/bitcoin-price charts)
  failed image preparation → those recipes rendered 500 for any device profile.
- [x] Device page hydration error (#418) from the relative "next refresh" chip.
- [x] BYOS release check: no timeout, no single-flight, retried GitHub on every page view after a
  failure.
- [x] Mixup slots rendered without the model's screen profile → half-size layout on TRMNL X.
- [x] Devices flickered "offline" at every check-in (no grace period).
- [x] Firmware waits 15 s for the image by default; cold Liquid/browser renders can exceed it →
  responses now carry `image_url_timeout: 30` (firmware source: `parse_response_api_display.cpp`).
- [~] Firmware sends `Access-Token` with the image download only when the image URL is same-origin
  with its API base URL; documented the `X-Forwarded-Proto` requirement (docs/api.md, README).
- [x] `recipeFetch` counted any non-OK response as a source failure, so a 404 from an optional
  enrichment lookup (Who's Overhead route/logo for an unknown callsign) discarded the live data
  and served stale or 500. Recipes can now pass `optional: true` for lookups they handle.

### Maintainability

- [x] `findOrCreateDevice` duplicates the API-key and MAC branches almost line for line.
- [x] Server actions accept unvalidated input (`updateDevice`, playlist saves).
- [x] Recipe data-refresh defaults live in a slug-keyed map far from the recipes.
- [x] Dead code: `cache-handler.js` (not wired into `next.config.ts`), duplicated filter builders in
  log actions.
- [x] README links to a non-existent `app/recipes/README.md`.
- [x] CI does not run a production build or database integration tests.

### Core pass (firmware contract, rendering, battery) — 2026-10-18

Checked against the firmware source (usetrmnl/trmnl-firmware: `src/display_session.cpp`,
`src/bl.cpp`, `lib/trmnl/src/api-client/request_headers.cpp`, `platformio.ini`).

- [x] **`status: 500` factory-resets the device** (`resetDeviceCredentials`: Wi-Fi + all
  preferences erased). Unexpected exceptions and "device not found" sent it. Now transient failures
  answer `status: 503` (keep screen), unknown devices get an error screen; the response module cannot
  emit 500. (`bd66536`)
- [x] **Every wake downloaded and redrew an identical image.** Firmware skips download when the
  `filename` is cached in flash and skips the e-ink refresh when it is the image on screen; names were
  random. `/api/display` now renders inline (8 s deadline) and names images `<label>-<sha256/14>.<ext>`
  (≤ 31 chars). Verified: same name across wakes, matches the served bytes; image download 37 ms from
  the shared render. `DISPLAY_FORCE_REFRESH=true` restores per-request names. (`bd66536`)
- [x] **Next frame warmed before the wake** (one timer per device, data freshness margin), so data
  fetches do not happen while the device waits with Wi-Fi on. (`b9d903a`)
- [x] **Button (special functions) did nothing**: header is `special_function` and firmware needs an
  echoed `action`. Parsed, echoed; `restart_playlist` restarts the playlist. (`cdb2885`)
- [x] **Firmware offers went to every board**; `FW<version>.bin` is the OG build (`Model: og`). Other
  boards (X, DIY kits) are no longer offered it. (`dfacef2`)
- [x] **Firmware model names** (`og`, `x`, `og_4clr`, …) are mapped to registry families (X now gets
  the `v2` profile automatically; an owner's choice within a family is kept); unknown-model warnings
  logged once per device instead of every wake. (`63fc9a3`)
- [x] **Dithering 3–6× faster, bit-identical** (rolling rows, no per-pixel allocation, scalar gray and
  RGB loops, direct-mapped colour cache); gray snap via lookup table. 1872×1404 gray-16 dithered:
  ~400 → ~70 ms (gray) / ~160 ms (tinted); 800×480: ~50 → ~11 ms. (`b479b3f`, `2c85fa2`, `ec8b004`,
  `cb12de6`)
- [ ] Not changed (would alter pixels): `supersample: true` renders 2× (3744×2808 on the X, ~500 ms
  raster) for simple-text and wikipedia; capping it for large panels is an option.
- [x] **1-bit images showed inverted on firmware ≤ 1.8.16** (reported on a 7.5" OG DIY kit, 1.8.10,
  which reports `Model: xiao_epaper_display`). Firmware `png_draw` checks a 2-entry palette's polarity
  backwards before 1.8.17 and the other way after, so no palette order works on both; black-and-white
  PNGs are now 1-bit grayscale, which every version draws as-is (also the X-class decoder).
  Refresh policy (`display_show_image`): 1-bit (or 2-colour) PNG → partial refresh, full every 8th
  update or with `maximum_compatibility`, "fast" when the interval is ≥ 30 min; 4-gray → always full.

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
- After `45ca0cf`: 198 unit + 20 Postgres integration tests, tsc/Biome clean, production build with no
  generated-file drift. Standalone server with **auth enabled**: missing-secret boot report; `/api/health`
  200; `/api/devices` without session → 401 JSON, pages → 307 sign-in; unknown device → claim code +
  pending claim row; first sign-up became admin via the shared pool; device display honoured a
  schedule stored as `"900"`; malformed `RSSI` ignored; image ETag → 304; `/api/log` 413/422/204;
  `/api/markup` runaway loop cut at 5.0 s; SIGTERM during that request → request completed, then exit.
- After `3781135`: 29 Postgres integration tests (incl. `/api/display` and `/api/setup` route tests),
  201 unit tests. Headless-Chrome smoke test (now `scripts/check-pages.cjs`, Playwright's Chromium via
  puppeteer-core; the T3 in-app browser is blocked by AppArmor on this host) of 12 pages in
  single-user mode: no page errors; only local-news (Reddit 403 from this IP) and whos-overhead
  (upstream unavailable) previews fail, both upstream. Device page "System logs" tab now lists the
  device's display rows.
- After `c463616`: `pnpm test:render` pixel baselines (800×480 bw, 480×800 gray-4, 1872×1404
  gray-16) still match exactly. Encode stage profiled in isolation at 1872×1404: ~110–135 ms
  (transform 38, reduce ~30, indexed pack ~25); the larger figures seen under load are thread-pool
  contention, not a hot spot.

- Final (after `e9ac005` + page smoke script): 207 unit / 40 suites, 29 Postgres integration tests,
  tsc/Biome clean, production build without generated-file drift; fresh DB with `AUTO_MIGRATE`
  applied all 25 migrations at boot; device setup → display (`image_url_timeout: 30`) → image → log;
  `/api/health`; pixel baselines exact; `pnpm test:browser` passed; page smoke test clean on
  dashboard, device, playlists, air-quality, sunrise-sunset, system logs, mixup, render inspector.

## Open / ideas not done

- Server-side checks, run against a live server: `pnpm test:render` (pixel baselines),
  `pnpm test:browser` (real Chrome), and the new `pnpm test:pages` (page smoke test; needs
  `BASE_URL` and `CHROME_EXECUTABLE_PATH` — on this host Playwright's Chromium lives under
  `~/.cache/ms-playwright/`).
- Rate limiting for public device endpoints (`/api/display`, `/api/bitmap`); single-user mode
  registers any token by design — documented under README "Security notes" instead.
- Gray-only fast path for encoding (1-channel reduce + pack) could save ~40 ms per X frame.
- `/api/bitmap` answers 500 with an error image when upstream data is unavailable and nothing is
  cached; 502/503 might describe that better (firmware treats any non-200 the same).
- Node engine pin is 22.22.3; validation here ran on Node 24.21.0.
