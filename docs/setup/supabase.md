# Supabase setup & migration workflow (M0-T10)

The dev database + the reversible migration workflow (Master Spec §73). The CLI project lives
under [`db/`](../../db): `db/supabase/config.toml` + `db/supabase/migrations/`.

> The CLI runs without a global install via `pnpm dlx supabase …`. For ongoing dev, install it
> properly (Windows: `scoop install supabase` / `winget install Supabase.cli`; macOS: `brew install
> supabase/tap/supabase`) or pin it as a dev dependency. **Requires Docker running.**

## Local workflow (no hosted project or keys needed)

All commands take `--workdir db` (so the CLI finds `db/supabase/config.toml`):

```bash
pnpm dlx supabase start  --workdir db   # boot the local stack (Postgres/PostgREST/Auth/Storage/Studio)
pnpm dlx supabase db reset --workdir db # recreate the DB and re-apply every migration from scratch
pnpm dlx supabase stop   --workdir db   # tear the stack down
```

`supabase db reset` is the M0-T10 verification: it drops + recreates the local DB and applies
`db/supabase/migrations/*.sql` in lexicographic order. The local stack prints local URLs + **shared
default** dev keys — these are well-known and **not secrets**; never use them anywhere but local.

## Migrations

- Live in `db/supabase/migrations/`, applied in filename order. `0000_init.sql` enables the
  foundational extensions (**PostGIS** for geometry, **pg_trgm** for name search). Schema
  (routes/spots/curvy_segments + RLS) lands at M2/M8.
- New migration: `pnpm dlx supabase migration new <name> --workdir db`, then edit the generated SQL.
- **Reversible by design:** `db reset` always rebuilds from migration 0 — so migrations must be
  self-contained and idempotent-friendly (`create extension if not exists …`, etc.).

## [HUMAN] Hosted dev project + keys (required for runtime, separate from the local workflow)

The local workflow above needs none of this. To connect the app/backend to a real dev backend:

1. **Owner:** create a Supabase **dev** project (and a separate **prod** project later) at
   supabase.com (free tier; 2 projects).
2. Copy the credentials into an untracked **`.env`** (never commit — see [`.env.example`](../../.env.example)
   and the zod loader `shared/src/config.ts`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client-safe),
   `SUPABASE_SERVICE_ROLE_KEY` (server-only secret).
3. Link the CLI for migration push later: `pnpm dlx supabase link --project-ref <ref> --workdir db`.

## ⚠️ Day-one: Data-API (PostgREST) grants — REQUIRED for new projects

**Verified (Dependency Verification §8):** Supabase projects **created after 30 May 2026** must add
**explicit Postgres grants** for the Data API (PostgREST) — tables are **not** auto-exposed to the
`anon` / `authenticated` roles. Roadopia's projects are new, so **this applies from day one** (it is a
setup step, not a future date).

For every table the Data API should serve, the migration that creates it must also grant the minimum
needed privileges and enable RLS, e.g.:

```sql
-- after: create table public.routes (...);
alter table public.routes enable row level security;          -- least privilege (Master Spec §55/§57)
grant select on public.routes to anon, authenticated;          -- read exposure via PostgREST
grant insert, update, delete on public.routes to authenticated; -- writes for logged-in owners (gated by RLS)
-- RLS policies (public-vs-private visibility, owner-only writes) are added with the schema at M8.
```

Without these grants, PostgREST returns empty/`permission denied` even though the rows exist. RLS
policies still govern *which* rows each role sees — grants only open the door; RLS guards it.

## Related day-one gotcha (tracked for M10, not here)

Storage objects are **not** auto-deleted when a row is removed — photo delete / fork / account
deletion needs explicit blob cleanup (Master Spec §56). Implemented with the photos feature at M10.
