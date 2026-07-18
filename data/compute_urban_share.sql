-- R19: per-segment urban context = fraction of segment length INSIDE 'built'
-- landuse polygons (buffer 0 — see migration 0011 for the boundary-arterial
-- rationale). Geometry-space length RATIO along the same line is direction-
-- consistent, so no geography cast needed. Idempotent: full recompute.
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
analyze curvy_segments;
