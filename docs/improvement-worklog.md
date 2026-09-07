# Server improvement worklog

Branch: `codex/trmnl-performance-reliability`. Each completed item is committed separately.
The pre-existing `data/trmnl/models.json` working-tree changes are retained, not staged.

## Sequence

- [x] Normalize nullable model image budgets and support updated UI scale variables.
- [ ] Fix machine authentication for browser previews and UUID webhooks.
- [ ] Cache rendered images with tenant isolation and concurrent request deduplication.
- [ ] Reduce database readiness overhead and add log retention.
- [ ] Retain last successful data/images and bound upstream work.
- [ ] Queue, isolate, and restrict browser renders.
- [ ] Optimize palette conversion and intermediate image encoding.
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
