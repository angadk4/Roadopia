-- M10-T01 — create_spot / update_spot RPCs (FR-030/031/034). Deletion needs
-- no RPC: PostgREST DELETE on /spots under the 0024 owner policy covers it.
--
-- SECURITY INVOKER like 0025: the 0024 RLS policies are the enforcement
-- (insert requires owner_id = auth.uid() AND source='user'; update/delete are
-- owner+user-source only, so OSM seeds stay display-only — FR-032/034).
-- Server-side truths the client cannot override:
--   owner_id := auth.uid()   source := 'user'
-- Input is BOUNDED (Hard rule K): type whitelist (matches the 0002+0009
-- check constraint), name 1..80 required, description ≤ 500, ≤ 10 tags of
-- ≤ 24 chars, coordinates must be finite lat/lng.

create or replace function create_spot(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_lat  double precision := (p->>'lat')::double precision;
  v_lng  double precision := (p->>'lng')::double precision;
  v_type text := p->>'type';
  v_name text := left(trim(coalesce(p->>'name', '')), 80);
begin
  if auth.uid() is null then
    raise exception 'sign in to add spots' using errcode = '42501';
  end if;
  if v_lat is null or v_lng is null or abs(v_lat) > 90 or abs(v_lng) > 180 then
    raise exception 'invalid location';
  end if;
  if v_type is null or v_type not in
     ('great_road', 'viewpoint', 'coffee', 'food', 'fuel', 'meetup', 'rest') then
    raise exception 'invalid spot type';
  end if;
  if v_name = '' then
    raise exception 'name required';
  end if;

  insert into spots (owner_id, type, name, description, tags, location, source)
  values (
    auth.uid(), v_type, v_name,
    left(coalesce(p->>'description', ''), 500),
    coalesce(
      (select array_agg(left(x, 24))
       from (select x from jsonb_array_elements_text(p->'tags') as t(x) limit 10) s),
      '{}'::text[]
    ),
    st_setsrid(st_makepoint(v_lng, v_lat), 4326),
    'user'
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function create_spot(jsonb) from public, anon;
grant execute on function create_spot(jsonb) to authenticated;

-- FR-034: owners edit their own spots (metadata only — the pin is the spot;
-- moving it is delete + recreate). RLS restricts to owner + source='user'.
create or replace function update_spot(p_id uuid, p jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update spots
     set name        = coalesce(left(trim(p->>'name'), 80), name),
         description = coalesce(left(p->>'description', 500), description),
         tags        = coalesce(
           (select array_agg(left(x, 24))
            from (select x from jsonb_array_elements_text(p->'tags') as t(x) limit 10) s),
           tags
         )
   where id = p_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;   -- false = not yours / OSM / gone (RLS filtered it)
end;
$$;

revoke all on function update_spot(uuid, jsonb) from public, anon;
grant execute on function update_spot(uuid, jsonb) to authenticated;
