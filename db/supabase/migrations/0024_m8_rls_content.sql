-- M8-T03 — the §55 RLS policy set + the M8 content tables.
--
-- Existing tables (routes/spots/route_spots) carry M6-era public-read
-- policies only; this migration completes ownership per §55 and creates
-- route_favourites / spot_favourites (per-target tables with REAL FKs —
-- §47's redesign away from polymorphic targets), user_preferences, reports,
-- and moderation_actions. Deny-by-default: RLS is enabled on every table and
-- anything not granted here does not happen. All auth.uid() calls are wrapped
-- in (select …) so Postgres caches them per-statement (initplan) instead of
-- per-row.

-- ---------- routes: ownership (§55 lines 1–2; FR-092/093) ----------
create policy routes_owner_read on routes
  for select using ((select auth.uid()) = owner_id);
create policy routes_owner_insert on routes
  for insert with check (
    (select auth.uid()) = owner_id
    and visibility in ('public', 'private', 'unlisted')
  );
create policy routes_owner_update on routes
  for update using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy routes_owner_delete on routes
  for delete using ((select auth.uid()) = owner_id);

grant select on routes to anon, authenticated;
grant insert, update, delete on routes to authenticated;

-- ---------- spots: user spots own-writable; OSM seed read-only ----------
create policy spots_owner_read on spots
  for select using ((select auth.uid()) = owner_id);
create policy spots_owner_insert on spots
  for insert with check ((select auth.uid()) = owner_id and source = 'user');
create policy spots_owner_update on spots
  for update using ((select auth.uid()) = owner_id and source = 'user')
  with check ((select auth.uid()) = owner_id and source = 'user');
create policy spots_owner_delete on spots
  for delete using ((select auth.uid()) = owner_id and source = 'user');

grant select on spots to anon, authenticated;
grant insert, update, delete on spots to authenticated;

-- ---------- route_spots: visibility follows the route; owner writes ----------
create policy route_spots_read on route_spots
  for select using (
    exists (
      select 1 from routes r
      where r.id = route_id
        and (r.visibility = 'public' or r.owner_id = (select auth.uid()))
    )
  );
create policy route_spots_owner_write on route_spots
  for insert with check (
    exists (select 1 from routes r where r.id = route_id and r.owner_id = (select auth.uid()))
  );
create policy route_spots_owner_delete on route_spots
  for delete using (
    exists (select 1 from routes r where r.id = route_id and r.owner_id = (select auth.uid()))
  );

grant select on route_spots to anon, authenticated;
grant insert, delete on route_spots to authenticated;

-- ---------- favourites: per-target tables, real FKs, own rows only ----------
create table if not exists route_favourites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  route_id   uuid not null references routes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);
create table if not exists spot_favourites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id)
);
alter table route_favourites enable row level security;
alter table spot_favourites enable row level security;

create policy route_favs_own on route_favourites
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy spot_favs_own on spot_favourites
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, delete on route_favourites to authenticated;
grant select, insert, delete on spot_favourites to authenticated;
create index if not exists route_favs_route_idx on route_favourites (route_id);
create index if not exists spot_favs_spot_idx on spot_favourites (spot_id);

-- ---------- user_preferences: stored settings, no learning (§35) ----------
create table if not exists user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  weights    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table user_preferences enable row level security;
create policy prefs_own on user_preferences
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on user_preferences to authenticated;

-- ---------- reports: anyone may report; only moderation reads ----------
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  target_type text not null check (target_type in ('route', 'spot', 'photo')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now()
);
alter table reports enable row level security;
-- §55: insertable by anyone (incl. anon abuse reporting); NO select policy for
-- app roles — reads happen via the service role (moderation tooling) only.
create policy reports_insert_any on reports
  for insert with check (reporter_id is null or reporter_id = (select auth.uid()));
grant insert on reports to anon, authenticated;
create index if not exists reports_target_idx on reports (target_type, target_id);

-- ---------- moderation_actions: service-role only (RLS on, no policies) ----------
create table if not exists moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  target_type text not null check (target_type in ('route', 'spot', 'photo')),
  target_id   uuid not null,
  action      text not null check (action in ('remove', 'restore', 'block')),
  note        text,
  created_at  timestamptz not null default now()
);
alter table moderation_actions enable row level security;
create index if not exists moderation_target_idx on moderation_actions (target_type, target_id);
