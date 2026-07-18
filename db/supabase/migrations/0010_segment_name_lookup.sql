-- 0010_segment_name_lookup.sql — R18-4: named roads become REAL routing
-- intents (Master Spec §3.4 location_constraints; R18 audit: "through Forks
-- of the Credit" was parsed then consumed by NOTHING).
--
-- Mechanism: a pg_trgm GIN index over curvy_segments.name + a SECURITY
-- DEFINER lookup RPC (the 0005 pattern — the anonymous /plan path may resolve
-- road names, and curvy_segments is public OSM-derived data by construction).
-- The resolver (backend/src/planner/resolve_locations.ts) turns matches into
-- pinned traversal spans ("through <road>"), keep-away discs ("avoid <area>")
-- and anchor-snapped waypoints ("near <town>").
--
-- DETERMINISTIC ORDER (frozen contract): exact name match first, then trigram
-- similarity desc, then curviness desc, then id asc — same input, same rows,
-- always (Hard rule A: the deterministic pipeline owns geography).
--
-- SECURITY DEFINER hygiene (0005): fixed search_path; EXECUTE revoked from
-- PUBLIC, granted to anon + authenticated + service_role. plpgsql body so the
-- envelope folds once (definer blocks SQL-function inlining — the measured
-- 0005 lesson).
--
-- pg_trgm is enabled since 0000_init.

-- Trigram index over road names (unnamed segments have name = '' and are
-- never lookup targets).
create index if not exists curvy_segments_name_trgm
  on curvy_segments using gin (name gin_trgm_ops);

create or replace function planner_find_segments_by_name(
  p_name text,
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_min_similarity double precision default 0.35,
  p_limit integer default 40
)
returns setof curvy_segments
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := trim(p_name);
  box geometry := st_makeenvelope(p_west, p_south, p_east, p_north, 4326);
begin
  if q = '' then
    return;
  end if;
  return query
  select cs.*
  from curvy_segments cs
  where cs.name <> ''
    and cs.geom && box
    and (lower(cs.name) = lower(q) or similarity(cs.name, q) >= p_min_similarity)
  order by
    (lower(cs.name) = lower(q)) desc,      -- exact beats fuzzy
    similarity(cs.name, q) desc,           -- then closest name
    cs.circum_curvature_per_km desc,       -- then the fun end of the road
    cs.id asc                              -- then total determinism
  limit greatest(1, least(p_limit, 200));
end
$$;

revoke execute on function planner_find_segments_by_name(
  text, double precision, double precision, double precision, double precision,
  double precision, integer
) from public;
grant execute on function planner_find_segments_by_name(
  text, double precision, double precision, double precision, double precision,
  double precision, integer
) to anon, authenticated, service_role;

-- down (manual):
--   drop function if exists planner_find_segments_by_name(text, double precision, double precision, double precision, double precision, double precision, integer);
--   drop index if exists curvy_segments_name_trgm;
