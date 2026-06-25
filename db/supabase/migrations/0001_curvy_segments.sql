-- 0001_curvy_segments.sql — curvature support table (SPK-10).
--
-- The compact per-way curvature table the planner's `find_curvy_roads` read-tool
-- queries (Master Spec §31/§44; Experimental Protocol §12). Geometry + curvature
-- metrics are computed offline (data/curvature/*) and loaded; this migration owns the
-- schema, the GiST spatial index, and the read function. The chosen formula and
-- THETA_CURVY are finalised at M4 [GATE-C]; both candidate metrics are stored for the
-- ablation. Reversible (see down section at bottom — Supabase applies up only).

create table if not exists curvy_segments (
  id                       bigserial primary key,
  osm_way_id               text        not null,
  name                     text        not null default '',
  highway                  text        not null,
  length_m                 double precision not null,
  -- C2: total absolute heading change per km (deg/km)
  heading_change_per_km    double precision not null,
  -- C7: length-weighted mean circumradius curvature over distance (1/km)
  circum_curvature_per_km  double precision not null,
  significant_turns_per_km double precision not null,
  geom                     geometry(LineString, 4326) not null
);

-- Spatial index for radius/bbox lookups (the find_curvy_roads access path).
create index if not exists curvy_segments_geom_gist on curvy_segments using gist (geom);
-- Supports curvature-thresholded scans / ordering.
create index if not exists curvy_segments_curv_idx on curvy_segments (circum_curvature_per_km);

-- find_curvy_roads — read tool: curvy segments within p_radius_m of a point whose
-- curvature ≥ p_min_curviness, most-curvy first. STABLE + read-only; the planner's
-- least-privilege read path (SPK-13) will expose it. Uses geography for true metres.
create or replace function find_curvy_roads(
  p_lon          double precision,
  p_lat          double precision,
  p_radius_m     double precision,
  p_min_curviness double precision default 0.6,  -- candidate THETA_CURVY (SPK-10), M4-final
  p_limit        integer default 200
)
returns setof curvy_segments
language sql
stable
as $$
  select *
  from curvy_segments
  where circum_curvature_per_km >= p_min_curviness
    and st_dwithin(
      geom::geography,
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  order by circum_curvature_per_km desc
  limit p_limit
$$;
