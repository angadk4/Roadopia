-- 0009_food_spots.sql — widen spots.type with 'food' (R16-1, Plan-screen stops).
--
-- Restaurants + fast food become first-class car spots ('food'); cafés remain
-- 'coffee'. The request domain (StopTypeSchema) always had 'food' — this closes
-- the spot-domain gap so STOP_TO_SPOT_TYPE.food can stop disclosing
-- "no food spots exist". Guarded drop/re-add per the 0006 pattern (idempotent).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'spots_type_check' and conrelid = 'spots'::regclass
  ) then
    alter table spots drop constraint spots_type_check;
  end if;
  alter table spots add constraint spots_type_check
    check (type in ('great_road', 'viewpoint', 'coffee', 'fuel', 'meetup', 'rest', 'food'));
end $$;
