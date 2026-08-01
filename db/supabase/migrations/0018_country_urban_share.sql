-- 0018_country_urban_share.sql — extend the dual-flank urban measure to the
-- roads R26 made retrievable (R26-A2 follow-up, review finding).
--
-- WHY: 0014 computed the dual-flank urban_share ONLY for `circum_curvature_per_km
-- >= 0.6`, and said so explicitly — "the rest keep their buffer-0 value (never
-- queried)". That was TRUE until migration 0017 opened a second retrieval door
-- for tertiary/unclassified roads BELOW that floor. Those 14 594 country rows
-- (mean stored urban_share 0.158) carry the OLD buffer-0 measure, which 0014
-- exists to replace because it under-reports built-up context — so the country
-- tier's own `p_max_urban_share` filter has been running on the blind measure
-- for most of its pool.
--
-- Empirically the tier did NOT drag town roads in (measured hood share fell on
-- both suites), but an adopted lever must not sit on a knowingly-stale input.
--
-- Scope: exactly the set planner_find_country_roads can return — country class,
-- non-ring — below the 0.6 line 0014 already covered. ~14.6 k rows, ~20 s at
-- 0014's measured rate. Idempotent: re-running recomputes the same values.

update curvy_segments cs
set urban_share = dualflank_urban_share(geom)
where circum_curvature_per_km < 0.6
  and highway in ('tertiary', 'unclassified')
  and not st_isclosed(geom);

analyze curvy_segments;
