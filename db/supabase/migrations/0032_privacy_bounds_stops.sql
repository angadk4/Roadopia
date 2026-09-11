-- 0032_privacy_bounds_stops.sql — review round after the device pass (2026-09-07, BD-202).
--
-- Six data-layer fixes the adversarial review confirmed, each a promise the app
-- was already making in copy or code:
--
--   1. "Link only" is link only. 0026's routes_unlisted_read policy made every
--      unlisted drive LISTABLE by anyone holding the anon key (RLS cannot tell a
--      by-id read from a list), and map_routes never filtered visibility of its
--      own — a "Link only" drive from someone's driveway was one of the 50 newest
--      lines on every anonymous map home. Browse surfaces now filter public
--      explicitly; the by-id share path is a least-privilege SECURITY DEFINER
--      read (route_by_id) that returns ONE row only when it is public, unlisted,
--      or the caller's own. fork_route reads through the same predicate.
--   2. A saved drive keeps its stops and its three-leg split (new `stops` and
--      `legs` columns, bounded and shaped to the wire schema — explicit nulls,
--      never stripped, so the app's strict parse accepts every stored row).
--   3. Direct PostgREST writes are bounded at the TABLE: the RPC caps guard only
--      the RPC path, while `authenticated` also holds insert/update on routes
--      and spots (Hard rule K).
--   4. profiles: readable by the OWNER only — the open read let anyone page
--      every account's uuid + email-derived display name. The 0023 length check
--      finally exists (0023's create-table was a no-op after 0002).
--   5. update_spot can clear tags ([] no longer coalesces back to the old set).
--   6. delete_account scrubs the user's briefs and parsed origins from
--      ai_generation_requests (the cost columns stay for the month ledger).
--
-- Idempotent by convention (re-runnable).

-- ---------- 2. stops + legs travel with a saved drive ------------------------

alter table routes add column if not exists stops jsonb not null default '[]'::jsonb;
alter table routes add column if not exists legs jsonb;

-- The wire shape (shared RouteStopSchema), enforced field by field. Anything
-- that would not parse on the phone is DROPPED here rather than stored — a row
-- the app cannot open is worse than a missing stop. Explicit JSON nulls for
-- arrival_s / at_fraction (the schema is nullable, not optional). ≤ 20 stops.
create or replace function sanitize_stops(p jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object(
        'name', left(s->>'name', 120),
        'type', left(s->>'type', 40),
        'requested_type', s->>'requested_type',
        'arrival_s', case when arr is not null and arr >= 0 then to_jsonb(arr) else 'null'::jsonb end,
        'at_fraction', case when frac in (0.25, 0.5, 0.75) then to_jsonb(frac) else 'null'::jsonb end,
        'location', jsonb_build_object('lat', lat, 'lng', lng),
        'waypoint_index', widx::integer
      ) order by ord)
     from (
       select
         x as s,
         ord,
         -- CASE guards the casts: a WHERE clause may evaluate its terms in any order
         case when jsonb_typeof(x->'location'->'lat') = 'number'
              then (x->'location'->>'lat')::double precision end as lat,
         case when jsonb_typeof(x->'location'->'lng') = 'number'
              then (x->'location'->>'lng')::double precision end as lng,
         case when jsonb_typeof(x->'waypoint_index') = 'number'
              then (x->>'waypoint_index')::numeric end as widx,
         case when jsonb_typeof(x->'arrival_s') = 'number'
              then (x->>'arrival_s')::double precision end as arr,
         case when jsonb_typeof(x->'at_fraction') = 'number'
              then (x->>'at_fraction')::numeric end as frac
       from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
            with ordinality as t(x, ord)
       limit 20
     ) q
     where jsonb_typeof(s) = 'object'
       and nullif(s->>'name', '') is not null
       and nullif(s->>'type', '') is not null
       and s->>'requested_type' in ('coffee', 'food', 'fuel', 'viewpoint', 'rest', 'great_road')
       and lat between -90 and 90
       and lng between -180 and 180
       and widx is not null and widx >= 0 and widx = floor(widx)
    ),
    '[]'::jsonb)
$$;

-- The R28 three-leg split: all eight keys or NULL (the honestly-absent value).
-- The two drive road-class shares may be null (unmeasured); the rest must be
-- non-negative numbers, percentages ≤ 100.
create or replace function sanitize_legs(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(p) = 'object' and q.ok then q.obj else null end
  from (
    select
      bool_and(
        case when k.k in ('drive_backroad_pct', 'drive_main_pct')
             then (c.v is null or (c.v >= 0 and c.v <= 100))
             else (c.v is not null and c.v >= 0 and (k.k not like '%\_pct' or c.v <= 100))
        end) as ok,
      jsonb_object_agg(k.k, c.v) as obj
    from unnest(array['there_pct', 'drive_pct', 'home_pct', 'there_m', 'drive_m', 'home_m',
                      'drive_backroad_pct', 'drive_main_pct']) as k(k)
    cross join lateral (
      select case when jsonb_typeof(p->k.k) = 'number' then (p->>k.k)::double precision end as v
    ) c
  ) q
$$;

-- ---------- 3. table-level bounds for the direct write path ------------------
-- Mirrors the RPC caps (0025/0031 save_route, 0027/0030 spots). NULL-safe: a
-- CHECK that evaluates to NULL passes, so every size term is coalesced.

alter table routes drop constraint if exists routes_name_len;
alter table routes add constraint routes_name_len
  check (char_length(name) <= 80);
alter table routes drop constraint if exists routes_description_len;
alter table routes add constraint routes_description_len
  check (char_length(description) <= 2000);
alter table routes drop constraint if exists routes_geometry_pts;
alter table routes add constraint routes_geometry_pts
  check (st_npoints(geometry) between 2 and 20000);
-- map_routes serves geometry_simplified when present — bound it too
alter table routes drop constraint if exists routes_geometry_simplified_pts;
alter table routes add constraint routes_geometry_simplified_pts
  check (geometry_simplified is null or st_npoints(geometry_simplified) <= 20000);
alter table routes drop constraint if exists routes_bbox_pts;
alter table routes add constraint routes_bbox_pts
  check (bbox is null or st_npoints(bbox) <= 5);
alter table routes drop constraint if exists routes_json_size;
alter table routes add constraint routes_json_size check (
  coalesce(pg_column_size(waypoints), 0)
  + coalesce(pg_column_size(elevation_profile), 0)
  + coalesce(pg_column_size(maneuvers), 0)
  + coalesce(pg_column_size(satisfied_constraints), 0)
  + coalesce(pg_column_size(stops), 0)
  + coalesce(pg_column_size(legs), 0) <= 1048576
);
alter table routes drop constraint if exists routes_tags_size;
alter table routes add constraint routes_tags_size
  check (pg_column_size(character_tags) <= 2048 and pg_column_size(free_tags) <= 2048);
alter table routes drop constraint if exists routes_explanation_len;
alter table routes add constraint routes_explanation_len
  check (agent_explanation is null or char_length(agent_explanation) <= 4000);
alter table routes drop constraint if exists routes_maneuvers_count;
alter table routes add constraint routes_maneuvers_count
  check (maneuvers is null
         or (jsonb_typeof(maneuvers) = 'array' and jsonb_array_length(maneuvers) <= 2000));
alter table routes drop constraint if exists routes_stops_shape;
alter table routes add constraint routes_stops_shape
  check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) <= 20);

-- Only user pins are ever written by the app path (0024 forces source='user');
-- OSM seed names carry no upper bound and are not touched.
alter table spots drop constraint if exists spots_user_bounds;
alter table spots add constraint spots_user_bounds check (
  source <> 'user' or (
    char_length(name) between 1 and 80
    and char_length(description) <= 500
    and cardinality(tags) <= 10
    and pg_column_size(tags) <= 512
  )
);

-- ---------- 1. unlisted = by link only ---------------------------------------

drop policy if exists routes_unlisted_read on routes;

-- The one by-id read. Least privilege: pinned search_path, a single row, and
-- the visibility predicate inside the function — no caller can widen it.
create or replace function route_by_id(p_id uuid)
returns setof routes
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
  from routes r
  where r.id = p_id
    and (r.visibility in ('public', 'unlisted') or r.owner_id = auth.uid())
  limit 1
$$;
revoke all on function route_by_id(uuid) from public;
grant execute on function route_by_id(uuid) to anon, authenticated;

-- map_routes: 0007's read, now filtering public ITSELF (0015's discover read
-- always did). A browse surface never relies on RLS alone.
create or replace function map_routes(p_limit integer default 50)
returns table (
  id             uuid,
  name           text,
  description    text,
  geometry       jsonb,
  bbox           jsonb,
  is_loop        boolean,
  distance_m     double precision,
  duration_s     integer,
  curviness      double precision,
  climb_m        double precision,
  character_tags text[],
  intensity      text,
  free_tags      text[],
  origin_type    text,
  visibility     text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.name,
    r.description,
    st_asgeojson(coalesce(r.geometry_simplified, r.geometry))::jsonb,
    case when r.bbox is not null then st_asgeojson(r.bbox)::jsonb end,
    r.is_loop,
    r.distance_m,
    r.duration_s,
    r.curviness,
    r.climb_m,
    r.character_tags,
    r.intensity,
    r.free_tags,
    r.origin_type,
    r.visibility
  from routes r
  where r.visibility = 'public'
  order by r.created_at desc
  limit p_limit
$$;

-- save_route: 0031 + stops/legs. Everything else unchanged — owner from
-- auth.uid(), private by default, bounded geometry/name/desc.
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
    maneuvers, stops, legs
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
    sanitize_maneuvers(p->'maneuvers'),
    sanitize_stops(p->'stops'),
    sanitize_legs(p->'legs')
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function save_route(jsonb) from public, anon;
grant execute on function save_route(jsonb) to authenticated;

-- fork_route: reads through the SAME visibility predicate as route_by_id (it
-- used to rely on the caller's RLS SELECT seeing unlisted rows), and carries
-- stops + legs like it carries the turns.
create or replace function fork_route(p_route_id uuid)
returns uuid
language plpgsql
security definer
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
    maneuvers, stops, legs
  )
  select
    auth.uid(), left(r.name || ' (fork)', 80), r.description, r.geometry,
    r.geometry_simplified, r.bbox,
    r.is_loop, r.waypoints, r.distance_m, r.duration_s, r.curviness,
    r.elevation_profile, r.climb_m, r.character_tags, r.intensity, r.free_tags,
    r.highway_flag, r.toll_flag, r.ferry_flag, r.unpaved_flag,
    'private', r.origin_type, r.id,
    null, null, null,
    r.maneuvers, r.stops, r.legs
  from routes r
  where r.id = p_route_id
    and (r.visibility in ('public', 'unlisted') or r.owner_id = auth.uid())
  returning id into v_id;
  if v_id is null then
    raise exception 'route not found or not visible';
  end if;
  return v_id;
end;
$$;

revoke all on function fork_route(uuid) from public, anon;
grant execute on function fork_route(uuid) to authenticated;

-- ---------- 4. profiles: owner-only read + the length check ------------------

alter table profiles alter column display_name drop default;
alter table profiles drop constraint if exists profiles_display_name_len;
alter table profiles add constraint profiles_display_name_len
  check (char_length(display_name) between 1 and 40);

drop policy if exists profiles_read on profiles;
drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles
  for select using ((select auth.uid()) = id);
-- nothing anonymous reads a profile (no public-profile surface exists)
revoke select on profiles from anon;

-- ---------- 5. update_spot: [] clears the tags -------------------------------
-- 0030's body (the blank-name guard stays), with the tags assignment fixed:
-- array_agg over zero elements is NULL, and coalesce handed the OLD tags back
-- while the RPC reported the row as updated.

create or replace function update_spot(p_id uuid, p jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  if p ? 'name' and v_name is null then
    raise exception 'name required';
  end if;

  update spots
     set name        = coalesce(left(v_name, 80), name),
         description = coalesce(left(p->>'description', 500), description),
         tags        = case
           when jsonb_typeof(p->'tags') = 'array' then coalesce(
             (select array_agg(left(x, 24))
              from (select x from jsonb_array_elements_text(p->'tags') as t(x) limit 10) s),
             '{}'::text[])
           else tags
         end
   where id = p_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;   -- false = not yours / OSM / gone (RLS filtered it)
end;
$$;

revoke all on function update_spot(uuid, jsonb) from public, anon;
grant execute on function update_spot(uuid, jsonb) to authenticated;

-- ---------- 7. one planner_find_curvy_roads ----------------------------------
-- The local stack carried BOTH the 0005 eight-argument signature and 0012's
-- nine-argument one (0012 dropped the old one, but a later re-run of 0005 —
-- the deploy-repair reflex — put it back). A call that names only the first
-- arguments then matches both and Postgres refuses it as "not unique"; the
-- backend names all nine, the positive-control db test did not. Idempotent.
drop function if exists planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[]
);

-- ---------- 6. delete_account: scrub the generation ledger -------------------
-- The FK is `on delete set null`, so without this the free-text brief and the
-- parsed origin (the user's own coordinates) outlived the account. Cost and
-- timestamp stay: the month ledger (FR-260) sums token_cost_usd by created_at.
-- The scrub runs BEFORE the auth row goes (the set-null makes it unmatchable).

create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  update ai_generation_requests
     set brief = '',
         parsed_constraints = null,
         metrics = '{}'::jsonb,
         user_id = null
   where user_id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;
