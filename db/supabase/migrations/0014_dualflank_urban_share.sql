-- 0014_dualflank_urban_share.sql — R21-0(b): recompute curvy_segments.urban_share
-- with the DUAL-FLANK measure (a faithful PostGIS port of the route-level
-- urban.ts isUrbanContext), replacing the buffer-0 inside-polygon ratio of
-- migration 0011 / data/compute_urban_share.sql.
--
-- WHY: buffer-0 measures only the fraction of a segment's length that lies
-- INSIDE a built polygon. OSM industrial/business-park/commercial parcels are
-- mapped with GAPS at the road, so a curvy collector threading such an estate
-- reads urban_share ~0.00 and slips past the R19 retrieval filter — the
-- parcel-gap blindness that let Standish Court (id 17950) into the pool at 0.00
-- (its closed-ring form is caught by 0013; the general class is not). Measured:
-- 314 high-curvature retrievable segments buffer-0 rated < 0.2 are actually
-- built-surrounded (Mississauga city-centre, Argentia/Palladium/High-Tech/
-- Bass-Pro-Mills industrial roads, Oxford/Bathurst/Lawrence urban arterials) —
-- all genuine urban collectors, ZERO rural roads (Forks of the Credit / Hockley
-- Road stay 0.00 under dual-flank). The function scores Standish's geometry 0.89
-- (vs buffer-0 0.00), proving the industrial-blindness fix — though the recompute
-- below SKIPS closed rings, so Standish's stored value stays 0.00; it is already
-- excluded by 0013's closed-ring filter. Dual-flank fixes the NON-ring collectors.
--
-- MEASURE: a point is urban-context if it is INSIDE a built polygon OR both
-- perpendicular ±120 m flanks are inside built (arterials thread town in the
-- parcel gap, so the point itself never tests inside; one-side-built — a main
-- road along fields — stays NON-urban, the owner's R19 rule verbatim). Segment
-- share = fraction of points (every ~60 m) that are urban-context. Same
-- constants as urban.ts (URBAN_FLANK_OFFSET_M 120, URBAN_RESAMPLE_M 60).
--
-- A/B (48-brief, buffer-0 vs dual-flank, both at FLOOR=1): no-route 0/48 flat
-- (the −15 % pool, 12,337 -> 10,514, did NOT starve — the removed material was
-- urban collectors, not drives); dirty units mean 1.81 -> 1.38 / max 18.06 ->
-- 11.77 (routes much cleaner — collectors force u-turns/overlap/residential);
-- urban p80 15 -> 13 %, arterial 74 -> 72 %, curvy p20 0.02 -> 0.04. Cost: AC
-- 17 -> 16 and mean presented 3.4 -> 3.2 (2 sparse briefs lose the ≥4-distinct
-- bar — but the dropped "options" were fake urban collectors, an honest
-- reduction), durErr p50 +2 pp. ADOPTED: cleaner drives + the blindness fix
-- outweigh a small coverage/duration cost. Rollback: re-run 0011's buffer-0
-- compute (data/compute_urban_share.sql, buffer-0 form).

create or replace function dualflank_urban_share(g geometry)
returns double precision
language sql
stable
as $$
  with pts as (
    select (dp).path[1] as idx, (dp).geom as pt
    from st_dumppoints(st_segmentize(g::geography, 60)::geometry) as dp
  ),
  dirs as (
    select idx, pt,
      st_azimuth(coalesce(lag(pt) over (order by idx), pt),
                 coalesce(lead(pt) over (order by idx), pt)) as az
    from pts
  ),
  flags as (
    select
      (exists (select 1 from landuse_zones lz
                where lz.kind = 'built' and lz.geom && pt and st_intersects(lz.geom, pt))
       or (
         exists (select 1 from landuse_zones lz
                  where lz.kind = 'built'
                    and st_intersects(lz.geom, st_project(pt::geography, 120, az - pi()/2)::geometry))
         and
         exists (select 1 from landuse_zones lz
                  where lz.kind = 'built'
                    and st_intersects(lz.geom, st_project(pt::geography, 120, az + pi()/2)::geometry))
       ))::int as urban
    from dirs where az is not null
  )
  select coalesce(avg(urban), 0) from flags;
$$;

-- Recompute over the RETRIEVABLE class only (curv >= 0.6, non-ring, drivable
-- classes) — the segments the planner can actually retrieve; the rest keep
-- their buffer-0 value (never queried). ~15 k rows, ~20 s.
update curvy_segments cs
set urban_share = dualflank_urban_share(geom)
where circum_curvature_per_km >= 0.6
  and not st_isclosed(geom)
  and highway not in (
    'residential','service','living_street','track','motorway','trunk',
    'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'
  );
analyze curvy_segments;
