-- 0002_core.sql — core schema: profiles, routes, spots, route_spots (M2-T07).
--
-- Authority: Master Spec §47–§48 (ER), §21 (route fields). Scope is the M2-T07
-- table set; photos/favourites/reports/moderation/user_preferences/
-- ai_generation_requests land with their owning milestones (M6/M8/M10).
--
-- Conventions:
--   - PostGIS LineString/Point 4326; enums as CHECK constraints on text (§48 shows
--     text; CHECKs keep additive migrations cheap).
--   - Day-one Data-API posture (docs/setup/supabase.md): RLS ENABLED on every table
--     + explicit minimal grants. NO policies yet — deny-by-default until the M8
--     visibility/ownership policies land (safe pre-launch default; direct/definer
--     access is unaffected).
--   - §47.2 note: the spec lists "B-tree on routes.bbox"; a B-tree over geometry
--     only supports equality, so the working equivalent is a GiST index on the
--     bbox envelope (intersection queries) — recorded fidelity judgment.

-- --- profiles (1:1 with auth.users) ---------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;
grant select on profiles to anon, authenticated;
grant insert, update, delete on profiles to authenticated;

-- --- routes (central entity, §21/§47) --------------------------------------
create table if not exists routes (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid references profiles (id) on delete cascade,
  name                  text not null default '',
  description           text not null default '',
  geometry              geometry(LineString, 4326) not null,
  geometry_simplified   geometry(LineString, 4326),
  bbox                  geometry(Polygon, 4326),
  is_loop               boolean not null default false,
  waypoints             jsonb not null default '[]'::jsonb,
  distance_m            double precision not null,
  duration_s            integer not null,
  curviness             double precision not null default 0,
  elevation_profile     jsonb,
  climb_m               double precision,
  character_tags        text[] not null default '{}',
  intensity             text not null default 'moderate'
                        check (intensity in ('chill', 'moderate', 'spirited')),
  free_tags             text[] not null default '{}',
  highway_flag          boolean not null default false,
  toll_flag             boolean not null default false,
  ferry_flag            boolean not null default false,
  unpaved_flag          boolean not null default false,
  visibility            text not null default 'private'
                        check (visibility in ('public', 'private')),
  origin_type           text not null
                        check (origin_type in ('ai', 'manual', 'recorded')),
  forked_from           uuid references routes (id) on delete set null,
  -- FK to ai_generation_requests is added when that table lands (M6).
  generation_request_id uuid,
  satisfied_constraints jsonb,
  agent_explanation     text,
  created_at            timestamptz not null default now()
);

create index if not exists routes_geometry_gist on routes using gist (geometry);
create index if not exists routes_geometry_simplified_gist on routes using gist (geometry_simplified);
create index if not exists routes_bbox_gist on routes using gist (bbox);
create index if not exists routes_owner_idx on routes (owner_id);
create index if not exists routes_visibility_idx on routes (visibility);
create index if not exists routes_distance_idx on routes (distance_m);

alter table routes enable row level security;
grant select on routes to anon, authenticated;
grant insert, update, delete on routes to authenticated;

-- --- spots (car spots; owner null = OSM-seeded, §47) ------------------------
create table if not exists spots (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references profiles (id) on delete cascade,
  type        text not null
              check (type in ('great_road', 'viewpoint', 'coffee', 'fuel', 'meetup', 'rest')),
  name        text not null default '',
  description text not null default '',
  tags        text[] not null default '{}',
  location    geometry(Point, 4326) not null,
  source      text not null default 'user' check (source in ('osm', 'user')),
  created_at  timestamptz not null default now()
);

create index if not exists spots_location_gist on spots using gist (location);
create index if not exists spots_owner_idx on spots (owner_id);

alter table spots enable row level security;
grant select on spots to anon, authenticated;
grant insert, update, delete on spots to authenticated;

-- --- route_spots (M:N + position, §47) --------------------------------------
create table if not exists route_spots (
  route_id  uuid not null references routes (id) on delete cascade,
  spot_id   uuid not null references spots (id) on delete cascade,
  position  integer not null default 0,
  primary key (route_id, spot_id)
);

alter table route_spots enable row level security;
grant select on route_spots to anon, authenticated;
grant insert, update, delete on route_spots to authenticated;
