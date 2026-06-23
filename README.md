# Roadopia

A grounded, **deterministic-first** AI road-trip route planner. A deterministic geospatial
pipeline owns all geography, routing, scoring, and validation; the LLM only parses intent,
explains results, and assists with titles/summaries/tags (within a gated, off-by-default
boundary). No speed / racing / timing framing — ever.

> **Status:** early build (milestone **M0 — Repository & Tooling**). This commit initializes
> the monorepo skeleton; most packages are still empty stubs.

## Monorepo layout

| Dir        | Purpose                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `app/`     | Mobile client (Expo / React Native + Mapbox).                                            |
| `backend/` | API server — the `/plan` SSE endpoint, deterministic planner, cost-guarded model client. |
| `shared/`  | Shared domain types + typed config (zod), consumed via the `@shared/*` alias.            |
| `db/`      | Supabase SQL migrations + RLS policies.                                                  |
| `data/`    | OSM extracts, Valhalla tiles, generated geodata (gitignored — large/local).              |
| `eval/`    | Route-planner evaluation harness + fixtures + CI gate.                                   |
| `infra/`   | Docker Compose, Valhalla, deploy/ops config.                                             |
| `docs/`    | The six authoritative spec docs (scope, methodology, deps, contract).                    |

## Toolchain

- **Package manager:** pnpm workspaces (`pnpm@11.8.0`).
- **Runtime:** Node `>=20`.
- **Language:** TypeScript `5.x` (strict), shared `tsconfig.base.json` + `@shared/*` path alias.

## Getting started

```bash
pnpm install
```

See `docs/` for the authoritative specifications. The build is driven one task at a time per the
project's resume system.
