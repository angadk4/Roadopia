-- M8-T04 — save_route RPC (FR-080: a generated/created route persists with
-- its AI metadata).
--
-- SECURITY INVOKER on purpose: the function runs AS THE CALLER, so the T03
-- RLS insert policy is the enforcement — this is a convenience shape, not a
-- privilege door. Server-side truths the client cannot override:
--   owner_id      := auth.uid()          (never from the payload)
--   visibility    := 'private' default   (recorded drives/saves private by
--                                         default — Hard rule E / FR-093)
--   geometry_simplified + bbox           (computed here; egress §44)
-- Input is BOUNDED (Hard rule K): name/description caps, geometry vertex cap,
-- visibility/intensity/origin whitelists — a bad payload is an exception,
-- never a mangled row.

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
    generation_request_id, satisfied_constraints, agent_explanation
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
    left(p->>'agent_explanation', 4000)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function save_route(jsonb) from public, anon;
grant execute on function save_route(jsonb) to authenticated;
