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
- [x] Add daily moon, botanical, and generative print recipes.

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

Daily art recipes work offline and accept an IANA timezone plus an optional fixed edition date. Moon phase uses an explicitly approximate mean-cycle model; botanical plates are decorative imagined specimens. Source notes are in the moon recipe.

Production build validation caught a request-time boundary in the recipe catalog. Static route generation now reads only built-in metadata, and the catalog declares request-time loading. Missing-database checks bypass the clock-based readiness cache entirely.

Browser smoke tests found that Liquid pages created with setContent have an opaque origin. Bundled public font assets now send CORS headers so Chromium can load them with web security enabled.

## Final results

- All 15 planned items are implemented, with a separate commit for each and follow-up commits for issues found during validation.
- Node 22.22.3 production build: passed (database disabled, recipe sync disabled, registry offline).
- Jest: 27 suites, 154 tests passed on Node 22.22.3. TypeScript and Biome passed.
- Takumi calibration: exact pixel matches at all three checked sizes/palettes.
- Real Chrome: bundled framework fonts loaded, screenshot pixels matched, and private resource requests were blocked (`pnpm test:browser`).
- Production React browser renderer: calibration and moon captures succeeded through signed preview tokens and one-use data snapshots.
- Interactive UI: inspector displayed output and cache hits; simulator selected the correct screen across the 18:00 window boundary in Asia/Kolkata.
- Art: landscape and portrait output visually reviewed. Fixed-date generation and local-midnight edition changes are covered by tests.
- A warm calibration request took 1.2 ms of measured server work locally; this is a small synthetic example, not a deployment benchmark.
- Existing model snapshot edits were compared byte-for-byte as a patch and preserved. No existing database was migrated; no logs were pruned; no deployment was made.

Operational notes: apply migration `0022_add_recipe_data_refresh.sql` through the existing setup/migration flow. Log pruning remains opt-in (`LOG_RETENTION_DAYS=0` by default). In-memory render/data caches and diagnostics are local to each process and reset on restart.

## Additional refresh performance sweep

- Encode already-quantized pixels directly into exact indexed PNGs; avoid a second palette search and dual PNG encoding unless the device byte budget requires compression fallbacks. Output pixels are unchanged.
- Serve bundled/last-known registry snapshots immediately and refresh them after the response. Firmware release checks also run after the response, so optional upstream metadata cannot delay a normal display refresh.
- Resolve React parameters and refresh settings in one tenant-scoped configuration query. Liquid rendering reuses its source-file lookup for both settings and templates.
- Cache public image downloads for at most 30 seconds, respecting upstream `no-store`, `private`, `no-cache`, `max-age`, and `Age`. Coalesce concurrent downloads and cache palette preparation by source bytes, dimensions and palette. Both caches are bounded to 32 MiB.
- Keep content-addressed encoded output until LRU eviction. Deterministic static screens and daily art retain frames for up to a day; daily editions include their timezone-derived date in the key. Parameter/data/version changes invalidate immediately. Undeclared recipes keep the 30-second default. Freshness timestamps no longer invalidate unchanged data; stale markers are cached separately.
- Save playlist position and device telemetry together in one scoped write. Failed playlist persistence still fails the display request.

Reproducible encoding-only benchmark: `pnpm benchmark:png` (one warm-up, median of five runs). Local Node 22.22.3 results:

| Calibration | Previous encoding | Indexed encoding | Speedup | Bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| 800×480, 2 colors | 101.45 ms | 4.88 ms | 20.8× | 5021 → 5147 |
| 480×800, 4 grays | 100.75 ms | 4.46 ms | 22.6× | 8487 → 8804 |
| 1872×1404, 16 grays | 552.88 ms | 24.72 ms | 22.4× | 33204 → 35735 |

These are local CPU encoding measurements, not whole-device refresh speedups. The benchmark discovers palette order from pixels, so compressed sizes can differ slightly from the device pipeline. All decoded pixels matched. The fast path trades a small file-size increase for CPU savings; tight device budgets still trigger stronger compression.

Production HTTP calibration checks measured cold rendering work of 115.9 ms at 800×480 and 282.9 ms at 1872×1404; repeated requests measured 0.5–0.9 ms of rendering work and 5.5–14.2 ms including local HTTP overhead. These runs used no database and offline registry snapshots, so they do not measure deployment/database latency or physical e-ink refresh time. Production pixel regressions and real Chrome font/network/screenshot checks passed again after this sweep.
