-- M8-T05/T07/T09 — fork, share semantics, account deletion.

-- ---------- T07: unlisted = readable by LINK (uuid knowledge), never listed --
-- The T03 select policies were public-or-own; 'unlisted' rows were unreadable
-- by recipients. Knowledge of the uuid IS the capability: shared links fetch
-- by id. Browse surfaces must filter visibility=public explicitly (and do —
-- map_routes/seed reads already do); RLS here only widens direct-id reads.
alter table routes
  drop constraint if exists routes_visibility_check,
  add constraint routes_visibility_check
    check (visibility in ('public', 'private', 'unlisted'));

create policy routes_unlisted_read on routes
  for select using (visibility = 'unlisted');

-- ---------- T05: fork_route — an independent, editable copy (FR-081) --------
-- SECURITY INVOKER: the caller's RLS select decides what is forkable (their
-- own routes + public + unlisted-by-id). The copy: owned by the caller,
-- PRIVATE by default, forked_from set; AI provenance fields are NOT copied
-- (the fork is the user's artifact — the original keeps its own provenance).
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
    generation_request_id, satisfied_constraints, agent_explanation
  )
  select
    auth.uid(), left(r.name || ' (fork)', 80), r.description, r.geometry,
    r.geometry_simplified, r.bbox,
    r.is_loop, r.waypoints, r.distance_m, r.duration_s, r.curviness,
    r.elevation_profile, r.climb_m, r.character_tags, r.intensity, r.free_tags,
    r.highway_flag, r.toll_flag, r.ferry_flag, r.unpaved_flag,
    'private', r.origin_type, r.id,
    null, null, null
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

-- forks survive their original: forked_from keeps history but never cascades
alter table routes
  drop constraint if exists routes_forked_from_fkey,
  add constraint routes_forked_from_fkey
    foreign key (forked_from) references routes (id) on delete set null;

-- ---------- T09: delete_account — real deletion, forks survive (FR-207) -----
-- SECURITY DEFINER by necessity (it deletes the auth.users row, which the
-- user role cannot touch), pinned search_path, and it deletes ONLY auth.uid()
-- — there is no parameter to aim at anyone else. Order: storage objects for
-- the user's photos (the row cascade does NOT remove blobs — Dependency
-- Verification §157), then the auth user; profiles/routes/spots/favourites/
-- prefs all cascade from auth.users / routes FKs. Forks others made survive
-- (independent rows; forked_from set-null via the constraint above).
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
  -- storage blobs for photos owned by this user (photos table arrives at M10;
  -- guarded so this function is correct both before and after)
  if to_regclass('public.photos') is not null then
    delete from storage.objects o
    using public.photos p
    where p.storage_path = o.name
      and o.bucket_id = 'photos'
      and p.owner_id = v_uid;
  end if;
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;
