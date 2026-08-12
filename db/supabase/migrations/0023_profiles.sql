-- M8-T02 — profiles (FR-090: 1:1 with the auth user; display name + avatar).
--
-- Created ON SIGN-UP by a trigger on auth.users (the Supabase-sanctioned
-- pattern: SECURITY DEFINER with a pinned search_path — the auth schema's
-- trigger context cannot see public otherwise). RLS is enabled HERE, not
-- deferred: a new table must never exist exposed-and-unpoliced (Hard rule E);
-- M8-T03 extends the policy set for the content tables.
--
-- display_name: derived from the email local part at creation (honest
-- default, user-editable); length-bounded at the DB so no client can bypass
-- the cap (Hard rule K). avatar_url: nullable; M10's processed-image path is
-- the only writer of real values (FR-310s) — until then profiles simply have
-- no avatar.

create table if not exists profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

-- Everyone (incl. anonymous browse) may read profiles — they front public
-- content (FR-091). Only the owner may change their own row; nobody inserts
-- directly (the trigger does) and nobody deletes directly (account deletion
-- cascades from auth.users — M8-T09).
create policy profiles_read on profiles
  for select using (true);
create policy profiles_update_own on profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- email local part, clipped to the profile cap; opaque fallback for
    -- e-mail-less identities (future providers)
    coalesce(nullif(left(split_part(new.email, '@', 1), 40), ''), 'driver')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- PostgREST grants (new-project Data-API requirement — Dependency
-- Verification §54: explicit grants are mandatory for tables to be visible).
grant select on profiles to anon, authenticated;
grant update (display_name, avatar_url) on profiles to authenticated;
