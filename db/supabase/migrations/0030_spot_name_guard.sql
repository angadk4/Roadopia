-- M10 review fix — update_spot must not accept a blank name.
--
-- create_spot rejects an empty name (0027), but update_spot's coalesce guard
-- only catches NULL: `trim('   ')` is a non-null empty string, so a direct
-- PostgREST call could blank the name of an existing spot, leaving a pin the
-- map renders as "Unnamed spot" and the owner cannot identify. The app guards
-- this client-side; the RPC is directly callable, so it guards itself now.

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
