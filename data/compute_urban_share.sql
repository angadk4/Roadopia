-- R19: per-segment urban context. buffer-0 (fraction of segment length INSIDE
-- 'built' landuse; see migration 0011 for the boundary-arterial rationale)
-- populates the column, then R21-0(b) OVERRIDES the RETRIEVABLE class with the
-- DUAL-FLANK measure (migration 0014's dualflank_urban_share — must be applied
-- first): buffer-0 is blind where industrial/business-park parcels are mapped
-- with gaps at the road, so curvy urban collectors read ~0.00 and slip the R19
-- filter. Non-retrievable segments keep buffer-0 (never queried). Idempotent.
update curvy_segments set urban_share = 0;
update curvy_segments cs
set urban_share = sub.share
from (
  select cs2.id,
         least(1.0, sum(st_length(st_intersection(cs2.geom, lz.geom)))
                    / nullif(st_length(cs2.geom), 0)) as share
  from curvy_segments cs2
  join landuse_zones lz
    on lz.kind = 'built'
   and cs2.geom && lz.geom
   and st_intersects(cs2.geom, lz.geom)
  group by cs2.id
) sub
where cs.id = sub.id;
-- R21-0(b): dual-flank override for the retrievable class (the parcel-gap fix).
update curvy_segments cs
set urban_share = dualflank_urban_share(geom)
where circum_curvature_per_km >= 0.6
  and not st_isclosed(geom)
  and highway not in (
    'residential','service','living_street','track','motorway','trunk',
    'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'
  );
analyze curvy_segments;
