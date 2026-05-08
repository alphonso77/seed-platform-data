# CLAUDE.md

## What is this project?

Seed Platform Data — a standalone CLI + web UI tool for seeding realistic test data into HubSpot, Stripe, and Shopify sandbox environments. Used to prove out integrations in the integrasentry product.

## Commands

```bash
# Development
npm run dev              # Express server (tsx watch, default port 3000 — set PORT in .env to override)
npm run dev:frontend     # Vite dev server (port 5172, proxies /api to backend PORT from root .env)
npm run dev:all          # Both concurrently

# CLI
npm run cli              # Interactive menu
npm run cli -- seed stripe --size medium --dry-run
npm run cli -- clean hubspot
npm run cli -- clean hubspot --orphans
npm run cli -- status
npm run cli -- validate shopify

# Build & test
npm run build            # tsc + tsc-alias → dist/
npm run build:frontend   # cd frontend && vite build
npm run typecheck        # tsc --noEmit
npm run lint             # eslint src/ test/
npm test                 # mocha (41 tests)
```

## Architecture

```
src/
  commands/     Command layer (seed, clean, status, validate) — shared by CLI and web API
  seeders/      Platform implementations extending BaseSeeder (abstract class + factory)
  generators/   Fake data generation (contacts, products, orders, emails)
  cli/          Commander.js entry + Inquirer.js interactive menu
  routes/       Express API routes — call commands/, never seeders/ directly
  config/       Zod-validated env vars, dataset size definitions, platform constants
  types/        All shared TypeScript types
  utils/        Logger (Winston), safety guards
  middleware/   Express error handler (AppError + Zod + catch-all)
  server.ts     Express app entry point
frontend/       React 19 + Vite + Tailwind CSS 4 + TanStack Query
```

## Key patterns

- **BaseSeeder abstract class** (`src/seeders/base-seeder.ts`) — all platform seeders extend this. Factory in `src/seeders/index.ts`.
- **Command layer** (`src/commands/`) — thin orchestrators that call seeders. Both CLI and API routes use this layer; never import seeders directly from routes or CLI.
- **Zod env validation** (`src/config/env.ts`) — validates at startup, accessed via `getEnv()`. Use `resetEnv()` in tests.
- **Safety guards** — every seed/clean calls `validateEnvironment()` first. Hard block on production environments. Override per-platform in dev with `SKIP_SANDBOX_CHECK_STRIPE`, `SKIP_SANDBOX_CHECK_HUBSPOT`, `SKIP_SANDBOX_CHECK_SHOPIFY` env vars (ignored in production). Logic in `src/utils/safety.ts` and `src/commands/validate.ts`.
- **Seeded data tagging** — Stripe uses metadata, HubSpot uses custom properties (auto-created by seeder), Shopify uses tags. Constants: `SEEDED_TAG` (`seed_platform_seeded`), `SEEDED_AT_TAG` (`seed_platform_seeded_at`) in `src/types/index.ts`. HubSpot clean leaves custom property definitions in place across runs — `ensureCustomProperties` is idempotent, and dropping them mid-run orphans surviving records and breaks subsequent searches. Pass `--orphans` (CLI flag, `orphans: true` in API/UI) to enable a deals-only fallback that searches by `dealname CONTAINS_TOKEN "Seed Order"` to recover records when the SEEDED_TAG property is missing.
- **Batched platform operations** — HubSpot seeds and cleans use `batchApi.create`/`batchApi.archive` chunked at 100 (HubSpot's per-batch limit) with per-record fallback on batch failure; progress logged per batch via `logger.info`. Each SEEDED_TAG search in HubSpot clean preflights via `propertyExists` and skips that block with a warn if the property is missing on the object type. Stripe clean branches by `invoice.status`: `draft` → `del`, `open`/`uncollectible` → `voidInvoice`, `void` → no-op (already cleaned), `paid` → warn and skip.
- **Path aliases** — `@/*`, `@config/*`, `@seeders/*`, `@generators/*`, `@commands/*`, `@cli/*`, `@routes/*`, `@types/*`, `@utils/*`. Resolved by tsc-alias at build time.
- **Response shape** — API returns `{ data: T }` consistently.

## Configuration

All config via environment variables (`.env`). Platform credentials are optional — only needed for the platforms you want to seed. See `.env.example`.

The backend port is configurable via `PORT` in `.env` (default 3000). The Vite dev server reads the same `PORT` from the root `.env` (via `loadEnv` in `frontend/vite.config.ts`) to target the `/api` proxy — keep them in sync by editing only the root `.env`.

## Testing

Mocha + Chai. Tests in `test/unit/`. ESLint uses `eslint-plugin-chai-friendly` to support Chai assertion syntax.

## Frontend theme

Light/dark/auto theme switching via `frontend/src/hooks/useTheme.ts`. Uses `useSyncExternalStore` (no context provider). Persists to `localStorage` key `theme-preference`. Class-based dark mode (`dark` class on `<html>`). Inline script in `index.html` prevents flash on load.

## CJS constraints

Project uses CommonJS (`"module": "commonjs"` in tsconfig). Chalk v4, Inquirer v8, and Ora v5 are pinned to CJS-compatible versions — do not upgrade to ESM-only versions.
