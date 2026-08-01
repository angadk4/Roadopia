-- 0017_country_roads.sql — the country-road retrieval tier (R26-A2).
--
-- WHY (BD-97, measured 2026-07-27): `curvy_segments` holds the WHOLE road
-- network, but every existing retrieval RPC gates drive material on
-- `circum_curvature_per_km >= p_min_curviness` (default 0.6) AND orders by
-- `circum_curvature_per_km desc limit N`. Straight country roads average ~0.10
-- curvature, so they fail the floor AND sort last — a mean 1 465 km of rural
-- tertiary/unclassified road per origin is loaded, indexed, and never offered
-- as drive material, while the planner rides main roads it can see. Six
-- refused levers (BD-39/62/81/82/93/96) all re-sorted a pool drawn from ~20 %
-- of the reachable country road.
--
-- WHAT: a SECOND retrieval tier, deliberately NOT a relaxation of the first.
-- It selects on CLASS (tertiary/unclassified — never residential, never
-- primary/secondary) with its own low curvature floor, and orders by
-- CLASS-WEIGHTED LENGTH so long country roads actually reach the limit. The
-- curvy tier is untouched; retrieval unions the two.
--
-- LEAST-PRIVILEGE (Hard rule E): SECURITY DEFINER with a fixed search_path,
-- mirroring planner_find_curvy_roads (0005). Reads only the public OSM corpus;
-- returns no user rows by construction.

create or replace function planner_find_country_roads(
  p_polygon jsonb,
  p_min_curviness double precision default 0.15, -- the R26-A2 sweep parameter
  p_limit integer default 200,
  p_max_urban_share double precision default 0.6
)
returns setof curvy_segments
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g geometry := st_geomfromgeojson(p_polygon::text);
begin
  return query
  select cs.*
  from curvy_segments cs
  where cs.highway in ('tertiary', 'unclassified')   -- COUNTRY class, by definition
    -- R21-0(a)/0013 parity, THE defect a pre-A/B review caught: the curvy RPC
    -- excludes closed rings (cul-de-sac bulbs, traffic circles — the Standish
    -- Court / Kuehne+Nagel U-turn poison). A second retrieval door without the
    -- same guard silently voids that guarantee. Measured on the live corpus:
    -- 20 of 8 775 qualifying rows (0.23 %) — pure poison removal, no starvation,
    -- and identical at every sweep floor (a ring is maximal-curvature by
    -- construction, so the floor never protects).
    and not st_isclosed(cs.geom)
    and cs.circum_curvature_per_km >= p_min_curviness
    and coalesce(cs.urban_share, 0) <= p_max_urban_share
    and cs.geom && g
    and st_intersects(cs.geom, g)
  -- THE gate-2 fix: order by class-weighted LENGTH, not curviness. Ordering by
  -- curviness is what made this material unreachable even at a zero floor —
  -- it always sorted behind the twisty set and the limit never got to it.
  order by (cs.length_m * case cs.highway
                            when 'unclassified' then 1.00
                            when 'tertiary'     then 0.95
                            else 0 end) desc,
           cs.id asc                                   -- deterministic tiebreak
  limit p_limit;
end;
$$;

grant execute on function planner_find_country_roads(jsonb, double precision, integer, double precision)
  to anon, authenticated, service_role;
