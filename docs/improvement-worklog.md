# Server improvement worklog

Branch: `codex/trmnl-performance-reliability`. Each completed item is committed separately.
The pre-existing `data/trmnl/models.json` working-tree changes are retained, not staged.

## Sequence

- [x] Normalize nullable model image budgets and support updated UI scale variables.
- [x] Fix machine authentication for browser previews and UUID webhooks.
- [x] Cache rendered images with tenant isolation and concurrent request deduplication.
- [x] Reduce database readiness overhead and add log retention.
- [x] Retain last successful data/images and bound upstream work.
- [x] Queue, isolate, and restrict browser renders.
- [x] Optimize palette conversion and intermediate image encoding.
- [x] Resolve browser recipe data once.
- [x] Make screenshot readiness deterministic and pin framework assets.
- [x] Add device calibration and visual regression coverage.
- [x] Enforce device image byte budgets with a valid fallback.
- [x] Support per-recipe data refresh intervals.
- [x] Add a render inspector.
- [x] Add playlist simulation for a selected date/time.
- [ ] Add daily moon, botanical, and generative print recipes.

## Validation

Run focused tests for each change, plus TypeScript, Biome, and diff checks at meaningful checkpoints.
Finish with the full test suite, a production build, and browser checks of new screens/tools.

Log retention is opt-in via `LOG_RETENTION_DAYS`; existing logs are preserved by default.

Last-successful data/images are bounded in-memory caches (up to 24h stale); a restart clears them.

Palette checkpoint: exact PNG/BMP/WebP bytes matched the previous encoder for synthetic RGBA input at 0° and 90°. The 1872×1404 solid-white 256-color snap benchmark fell from 1841 ms to 25 ms locally (synthetic, not end-to-end).

Readiness checkpoint: headless Chrome waited for delayed recipe content and image decode; corrupt images were rejected. Framework 3.3.1 CSS, JavaScript, and fonts are bundled with source hashes.

Visual test server uses the pinned Node 22.22.3 runtime; Node 26 development route discovery failed locally. Calibration also exposed and fixed skipped dithering of data-URL images.

Refresh controls require migration `0022_add_recipe_data_refresh.sql`; no existing database was migrated during this work.

Playlist simulation shares the device selector, including sparse order values, midnight, weekday boundaries and DST. Overnight windows belong to the starting weekday. Simulation excludes device sleep and network delays.
