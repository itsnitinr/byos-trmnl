# Agent notes

BYOS (Bring Your Own Server) for TRMNL e-ink devices: Next.js 16 (App Router, cache components),
React 19, Postgres via Kysely with row-level security, Takumi/Satori/Chrome renderers.

- Ongoing audit status and hand-off notes: `docs/audit/PROGRESS.md`. Update it as you work.
- Device-facing contract: `docs/api.md`. Recipe authoring: `docs/recipes.md`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check (pnpm lint:fix to apply)
pnpm test             # jest unit tests
pnpm test:db          # integration tests; needs TEST_DATABASE_URL (throwaway Postgres only)
pnpm build            # runs generate:sql + generate:recipes first
```

## Layout

- `app/api/display`, `app/api/setup`, `app/api/log` — endpoints the device firmware calls.
- `app/api/bitmap` — renders a recipe to the device image format.
- `lib/database` — Kysely instance, RLS scoping helpers (`scoped-db.ts`), migration runner.
- `lib/recipes` — recipe registry, data runtime, Liquid renderer, rasterizers.
- `lib/render` — device encoding (palette reduction, indexed PNG, BMP), frame caches.
- `migrations/*.sql` — append-only. After adding one, run `pnpm generate:sql`.

## Rules of thumb

- Tenant data must go through `withUserScope` / `withExplicitUserScope` so RLS applies; the bare
  `db` connects as the owner role and bypasses RLS.
- Never edit an applied migration; checksums are verified. Add a new numbered file.
- Device endpoints must answer quickly and never fail on optional work (firmware checks, logging,
  registry refresh). Push that work after the response (`afterResponse`).
