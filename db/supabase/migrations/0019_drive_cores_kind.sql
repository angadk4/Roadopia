-- 0019_drive_cores_kind.sql — let the drive-core read filter by KIND (R29 Unit A).
--
-- WHY (measured, 2026-08-04): the r31 index holds 1 114 ribbons (avg 9 min,
-- backroad_share ~1.0) and 430 loop cores (avg 63 min). The definer orders by
-- backroad_share × curviness and hard-caps at 50 rows, so ribbons swamp every
-- browse — and then EVERY ribbon fails the v2 menu's connector-share drop
-- ("mostly getting-there": a 9-minute drive is never worth a 15-minute trip
-- to it). Measured result: 0/8 sample origins produced a menu while 430
-- card-worthy loop cores sat unreachable behind the cap.
--
-- The two consumers want different material and can now say so:
--   Discover v2 menus  -> kind_filter='loop'   (cards must be worth the trip)
--   drive-first chains -> kind_filter='ribbon' (short measured spans to chain)
--
-- Backward compatible: kind_filter defaults NULL = old behaviour; the 6-arg
-- signature replaces the 5-arg one (CREATE OR REPLACE cannot change arg lists,
-- so the old function is dropped first — callers all go through
-- readDriveCores, updated in the same commit).

drop function if exists discover_drive_cores(
  double precision, double precision, double precision, double precision, text, integer
);

create or replace function discover_drive_cores(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  serving_version text,
  max_rows integer default 20,
  kind_filter text default null
)
returns table (
  id               text,
  kind             text,
  name             text,
  bar_profile      text,
  geom_simplified  jsonb,
  entry            jsonb,
  exit             jsonb,
  distance_m       double precision,
  duration_s       integer,
  curviness        double precision,
  backroad_share   double precision,
  main_share       double precision,
  highway_share    double precision,
  hood_share       double precision,
  turns_per_10min  double precision,
  loopiness        double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.kind, c.name, c.bar_profile, c.geom_simplified, c.entry, c.exit,
    c.distance_m, c.duration_s, c.curviness, c.backroad_share, c.main_share,
    c.highway_share, c.hood_share, c.turns_per_10min, c.loopiness
  from drive_cores c
  where c.bbox && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    -- serving guards INSIDE the definer (a bad row can never be served):
    and c.highway_share = 0
    and c.generator_version = serving_version
    and (kind_filter is null or c.kind = kind_filter)
  order by
    (c.bar_profile = 'strict') desc,
    c.backroad_share * least(c.curviness, 3.0) desc,
    c.id asc
  limit greatest(1, least(max_rows, 50))
$$;

grant execute on function discover_drive_cores(
  double precision, double precision, double precision, double precision, text, integer, text
) to anon, authenticated, service_role;
