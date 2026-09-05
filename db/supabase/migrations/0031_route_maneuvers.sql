-- Device pass (2026-09-04) — a saved route carries its turn-by-turn maneuvers.
--
-- WHY: follow-mode used to re-derive guidance by map-matching the saved line
-- through /match and trusting the result only when the matched length agreed
-- within 10 %. A closed loop retraces its stem, the matcher shortcuts it, and
-- the owner's 123 km loop came back as 72 km — guidance "unavailable" on
-- every loop he tried. The planner / router / matcher had the exact maneuvers
-- for the exact geometry at save time; they were simply dropped. Now they
-- travel with the row (and with forks).
--
-- Bounded (Hard rule K): ≤ 2,000 entries (the wire schema's cap — a 3-hour
-- loop is ~40–80), each {type ≤ 40 chars, instruction ≤ 200 chars,
-- distance_m a finite 0..10,000,000 m, street_names ≤ 5 × 60 chars, nulls
-- dropped}. A payload that is not an array, or is too long, stores NULL
-- (guidance honestly absent, the app's fallback path) — never a mangled row
-- and never an exception that costs the user the save itself (a numeric
-- outside the double range is dropped, not cast). NULL on legacy rows means
-- the same thing.

alter table routes add column if not exists maneuvers jsonb;

create or replace function sanitize_maneuvers(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p is null
      or jsonb_typeof(p) <> 'array'
      or jsonb_array_length(p) > 2000 then null
    else (
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'type', left(coalesce(m->>'type', 'unknown'), 40),
          'instruction', left(coalesce(m->>'instruction', ''), 200),
          'distance_m', case
            when jsonb_typeof(m->'distance_m') = 'number'
              and (m->>'distance_m')::numeric between 0 and 10000000
              then (m->>'distance_m')::double precision
          end,
          'street_names', case
            when jsonb_typeof(m->'street_names') = 'array' then (
              select jsonb_agg(left(s, 60))
                from jsonb_array_elements_text(m->'street_names') with ordinality as t(s, i)
               where i <= 5 and s is not null
            )
          end
        ))
      )
      from jsonb_array_elements(p) as m
      where jsonb_typeof(m) = 'object'
    )
  end
$$;

-- save_route: 0025 + the maneuvers column. Everything else is unchanged —
-- owner from auth.uid(), private by default, bounded geometry/name/desc.
create or replace function save_route(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_geom geometry;
  v_pts  integer;
  v_id   uuid;
  v_name text := left(coalesce(p->>'name', 'Untitled drive'), 80);
  v_desc text := left(coalesce(p->>'description', ''), 2000);
  v_vis  text := coalesce(p->>'visibility', 'private');
begin
  if auth.uid() is null then
    raise exception 'sign in to save routes' using errcode = '42501';
  end if;
  if v_vis not in ('public', 'private', 'unlisted') then
    raise exception 'invalid visibility';
  end if;
  if p->'geometry' is null then
    raise exception 'geometry required';
  end if;
  v_geom := st_setsrid(st_geomfromgeojson(p->>'geometry'), 4326);
  v_pts := st_npoints(v_geom);
  if v_pts < 2 or v_pts > 20000 then
    raise exception 'geometry out of bounds (% points)', v_pts;
  end if;

  insert into routes (
    owner_id, name, description, geometry, geometry_simplified, bbox,
    is_loop, waypoints, distance_m, duration_s, curviness,
    elevation_profile, climb_m, character_tags, intensity, free_tags,
    highway_flag, toll_flag, ferry_flag, unpaved_flag,
    visibility, origin_type, forked_from,
    generation_request_id, satisfied_constraints, agent_explanation,
    maneuvers
  ) values (
    auth.uid(), v_name, v_desc, v_geom,
    st_simplifypreservetopology(v_geom, 0.0002), st_envelope(v_geom),
    coalesce((p->>'is_loop')::boolean, false),
    coalesce(p->'waypoints', '[]'::jsonb),
    greatest(0, coalesce((p->>'distance_m')::double precision, 0)),
    greatest(0, coalesce((p->>'duration_s')::integer, 0)),
    greatest(0, coalesce((p->>'curviness')::double precision, 0)),
    p->'elevation_profile',
    (p->>'climb_m')::double precision,
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p->'character_tags') as t(x)),
      '{}'::text[]
    ),
    case when p->>'intensity' in ('chill','moderate','spirited') then p->>'intensity' else 'chill' end,
    coalesce(
      (select array_agg(left(x, 40)) from jsonb_array_elements_text(p->'free_tags') as t(x)),
      '{}'::text[]
    ),
    coalesce((p->>'highway_flag')::boolean, false),
    coalesce((p->>'toll_flag')::boolean, false),
    coalesce((p->>'ferry_flag')::boolean, false),
    coalesce((p->>'unpaved_flag')::boolean, false),
    v_vis,
    case when p->>'origin_type' in ('ai','manual','recorded') then p->>'origin_type' else 'ai' end,
    null,
    (p->>'generation_request_id')::uuid,
    p->'satisfied_constraints',
    left(p->>'agent_explanation', 4000),
    sanitize_maneuvers(p->'maneuvers')
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function save_route(jsonb) from public, anon;
grant execute on function save_route(jsonb) to authenticated;

-- fork_route: 0026 + the maneuvers column (a fork without its turns would
-- lose guidance the original had).
create or replace function fork_route(p_route_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in to fork routes' using errcode = '42501';
  end if;
  insert into routes (
    owner_id, name, description, geometry, geometry_simplified, bbox,
    is_loop, waypoints, distance_m, duration_s, curviness,
    elevation_profile, climb_m, character_tags, intensity, free_tags,
    highway_flag, toll_flag, ferry_flag, unpaved_flag,
    visibility, origin_type, forked_from,
    generation_request_id, satisfied_constraints, agent_explanation,
    maneuvers
  )
  select
    auth.uid(), left(r.name || ' (fork)', 80), r.description, r.geometry,
    r.geometry_simplified, r.bbox,
    r.is_loop, r.waypoints, r.distance_m, r.duration_s, r.curviness,
    r.elevation_profile, r.climb_m, r.character_tags, r.intensity, r.free_tags,
    r.highway_flag, r.toll_flag, r.ferry_flag, r.unpaved_flag,
    'private', r.origin_type, r.id,
    null, null, null,
    r.maneuvers
  from routes r
  where r.id = p_route_id
  returning id into v_id;
  if v_id is null then
    raise exception 'route not found or not visible';
  end if;
  return v_id;
end;
$$;
revoke all on function fork_route(uuid) from public, anon;
grant execute on function fork_route(uuid) to authenticated;
