-- M10-T05/T07 — photo-blob cleanup goes through the Storage API, not SQL.
--
-- MEASURED correction (M10 build, live smoke): current Supabase Storage
-- installs a protect_delete() trigger on storage.objects — any direct SQL
-- delete raises "Direct deletion from storage tables is not allowed. Use the
-- Storage API instead." That invalidates BOTH the trigger this migration
-- first shipped as AND the storage-cleanup block 0026 put inside
-- delete_account (latent until the photos table existed; armed today).
--
-- New shape (Hard rule E — real deletion INCLUDING blobs — unchanged):
--   - SQL owns ROWS only. delete_account deletes auth.users; photo rows
--     cascade (photos.owner_id → profiles → auth.users).
--   - The BACKEND owns blobs, via the Storage REST API (service role):
--     DELETE /photos/:id, DELETE /spots/:id and DELETE /account. Blob removal
--     is idempotent (404 = already gone).
--   - Blob cleanup is a PREFIX SWEEP (storage list + delete under
--     `<owner>/<spot>/`), not a list of paths read from rows, so it needs no
--     surviving rows, catches anything uploaded mid-request, and is safe to
--     repeat. Ordering differs per path on purpose: photo/spot deletes drop
--     rows first (an orphaned blob is UNREACHABLE — no row can sign it),
--     while ACCOUNT deletion sweeps blobs FIRST, because deleting the auth
--     user is unretryable and a later failure would strand photos forever.

-- retire the invalid trigger approach (shipped earlier this same session,
-- never committed anywhere)
drop trigger if exists photos_blob_cleanup on photos;
drop function if exists photos_cleanup_blobs();

-- delete_account: rows only — the backend's DELETE /account wraps this RPC
-- and does the blob sweep via the Storage API before calling it.
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
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;
