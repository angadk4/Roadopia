-- 0006_ai_generation_requests.sql — the per-generation ledger (M6-T04;
-- FR-049 "Each generation MUST be logged … with parsed constraints, status,
-- iterations, latency, token cost, and per-constraint metrics"; §47.1).
--
-- Doubles as the eval/analytics log feeding the public eval page (via a
-- future aggregates-only read path, §55) and as the month-spend source the
-- production cost guard primes from at boot (FR-260 accounting survives
-- restarts). `metrics` jsonb carries per-constraint outcomes, tool-call
-- success, diversity, the timeout flag, and the precise planner status
-- (the `status` column is the §47.1 3-value enum).
--
-- RLS (§55): "readable by owner; anonymous rows not tied to a user." No
-- anon read path; writes come only from the backend's scoped path (§43) —
-- no insert grants to anon/authenticated.

create table if not exists ai_generation_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references profiles (id) on delete set null,
  brief              text not null,
  parsed_constraints jsonb,
  status             text not null check (status in ('ok', 'relaxed', 'failed')),
  result_route_id    uuid references routes (id) on delete set null,
  iterations         integer not null default 0,
  latency_ms         integer not null default 0,
  token_cost_usd     double precision not null default 0,
  metrics            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists agr_created_idx on ai_generation_requests (created_at);
create index if not exists agr_user_idx on ai_generation_requests (user_id);

alter table ai_generation_requests enable row level security;

-- owner-readable; anon rows (user_id null) readable by no one (§55)
drop policy if exists agr_owner_read on ai_generation_requests;
create policy agr_owner_read on ai_generation_requests
  for select using (auth.uid() = user_id);
grant select on ai_generation_requests to authenticated;

-- the deferred FK from routes (0002 note: "added when that table lands (M6)")
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'routes_generation_request_fk'
  ) then
    alter table routes
      add constraint routes_generation_request_fk
      foreign key (generation_request_id)
      references ai_generation_requests (id) on delete set null;
  end if;
end
$$;
