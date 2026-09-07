# Device rendering regressions

Run the application using its pinned Node 22.22.3 runtime, no database, offline model snapshots, and the Takumi renderer:

```sh
DATABASE_URL='' AUTH_ENABLED=false REACT_RENDERER=takumi SKIP_RECIPE_SYNC=true TRMNL_REGISTRY_OFFLINE=true NEXT_DIST_DIR=.next-audit PORT=3011 pnpm dlx node@22.22.3 node_modules/next/dist/bin/next dev --port 3011
pnpm test:render
```

Set `RENDER_TEST_URL` to target another isolated test server. `node scripts/check-rendering.mjs --update` records new baselines; inspect every image before accepting updates. The checks compare decoded pixels at 800×480/bw, 480×800/gray-4, and 1872×1404/gray-16. Failures save an ignored `.actual.png` beside the expected image.

For real Chrome checks (framework font loading, screenshot pixels, and blocked private resources), keep that server running and execute:

```sh
PORT=3011 CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome pnpm test:browser
```

Set the executable path for your installation, or use the existing `BROWSER_URL` / `BROWSER_WS_ENDPOINT` configuration. Run with the pinned Node runtime. The smoke script uses isolated browser contexts and does not write to the database.

Run `pnpm benchmark:png` to compare the previous dual PNG encoding path with the exact indexed encoder using these fixtures. It warms each path once, reports the median of five samples and encoded byte sizes, and asserts identical decoded pixels. No server is needed. This measures encoding only, not database, network, rasterization or device refresh time.

Recipe authors can set `meta.renderSettings.cacheSeconds` (default 30, capped at 86400) for deterministic content. Cache identity already includes user, parameters, data, recipe version, dimensions, palette and renderer. If a component reads the clock, leave the short default or supply `getRenderCacheKey(params, data)` that changes with every visible time interval; daily art uses its local edition date. Do not extend lifetimes for mutable image URLs or other implicit inputs without an appropriate key. Data refresh intervals remain independent and are resolved before frame-cache lookup.
