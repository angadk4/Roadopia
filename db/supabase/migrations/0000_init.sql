-- 0000_init.sql — initial migration (M0-T10).
--
-- Infrastructure-only: enables the foundational Postgres extensions the data tier
-- relies on. The actual schema (routes, spots, curvy_segments, RLS policies, …)
-- lands at M2/M8. Kept intentionally minimal + reversible.

-- Spatial types + indexes (route/spot geometry, GiST indexes) — Master Spec §41/§42.
create extension if not exists postgis;

-- Trigram fuzzy search on route/spot names — Master Spec §47.
create extension if not exists pg_trgm;
