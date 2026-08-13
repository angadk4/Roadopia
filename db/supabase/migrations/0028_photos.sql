-- M10-T05 — photos table + private storage bucket (FR-035/036, spec §56).
--
-- Naming matches what 0026's delete_account already guards: public.photos
-- with storage_path + owner_id, bucket_id 'photos'.
--
-- Posture (Hard rule E: no image served before EXIF strip + re-encode):
--   - The bucket is PRIVATE and app roles get NO storage.objects policies —
--     clients can neither upload nor read blobs directly, ever.
--   - The photos table has NO insert policy for app roles: rows are written
--     only by the backend pipeline (service role) AFTER processing. A raw
--     original never exists anywhere retrievable.
--   - Reads are owner-scoped (user spots are owner-visible in MVP);
--     delivery is via backend-signed URLs.

create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references profiles (id) on delete cascade,
  spot_id      uuid not null references spots (id) on delete cascade,
  storage_path text not null,
  thumb_path   text not null,
  created_at   timestamptz not null default now()
);

create index if not exists photos_spot_idx on photos (spot_id);
create index if not exists photos_owner_idx on photos (owner_id);

alter table photos enable row level security;

create policy photos_owner_read on photos
  for select using ((select auth.uid()) = owner_id);
create policy photos_owner_delete on photos
  for delete using ((select auth.uid()) = owner_id);

grant select, delete on photos to authenticated;
-- NO insert/update grants for app roles — the processing pipeline is the
-- only writer (service role bypasses RLS by design).

-- Private bucket; 'photos' to match delete_account's cleanup join.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;
