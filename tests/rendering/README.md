# Device rendering regressions

Run the application using its pinned Node 22.22.3 runtime, no database, offline model snapshots, and the Takumi renderer:

```sh
DATABASE_URL='' AUTH_ENABLED=false REACT_RENDERER=takumi SKIP_RECIPE_SYNC=true TRMNL_REGISTRY_OFFLINE=true NEXT_DIST_DIR=.next-audit PORT=3011 pnpm exec next dev --port 3011
pnpm test:render
```

Set `RENDER_TEST_URL` to target another isolated test server. `node scripts/check-rendering.mjs --update` records new baselines; inspect every image before accepting updates. The checks compare decoded pixels at 800×480/bw, 480×800/gray-4, and 1872×1404/gray-16. Failures save an ignored `.actual.png` beside the expected image.
