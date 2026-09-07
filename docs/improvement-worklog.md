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
- [ ] Resolve browser recipe data once.
- [ ] Make screenshot readiness deterministic and pin framework assets.
- [ ] Add device calibration and visual regression coverage.
- [ ] Enforce device image byte budgets with a valid fallback.
- [ ] Support per-recipe data refresh intervals.
- [ ] Add a render inspector.
- [ ] Add playlist simulation for a selected date/time.
- [ ] Add daily moon, botanical, and generative print recipes.

## Validation

Run focused tests for each change, plus TypeScript, Biome, and diff checks at meaningful checkpoints.
Finish with the full test suite, a production build, and browser checks of new screens/tools.

Log retention is opt-in via `LOG_RETENTION_DAYS`; existing logs are preserved by default.

Last-successful data/images are bounded in-memory caches (up to 24h stale); a restart clears them.

Palette checkpoint: exact PNG/BMP/WebP bytes matched the previous encoder for synthetic RGBA input at 0° and 90°. The 1872×1404 solid-white 256-color snap benchmark fell from 1841 ms to 25 ms locally (synthetic, not end-to-end).
