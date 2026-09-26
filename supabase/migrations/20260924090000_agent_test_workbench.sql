begin;

create table public.agent_test_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_type text not null check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing')),
  title text not null check (char_length(title) between 1 and 120),
  prompt text not null default '' check (char_length(prompt) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_test_versions (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references public.agent_test_cases(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0 check (position >= 0),
  model_config_id uuid references public.user_model_configs(id) on delete set null,
  knowledge_sources text[] not null default array['project_context', 'project_knowledge', 'agent_general_knowledge']::text[],
  skill_slugs text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_test_versions_knowledge_sources_valid check (
    knowledge_sources <@ array['project_context', 'project_knowledge', 'agent_general_knowledge']::text[]
  ),
  unique (test_case_id, position)
);

create table public.agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references public.agent_test_cases(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete cascade,
  prompt_snapshot text not null check (char_length(prompt_snapshot) between 1 and 8000),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.agent_test_run_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_test_runs(id) on delete cascade,
  version_id uuid references public.agent_test_versions(id) on delete set null,
  version_name text not null,
  config_snapshot jsonb not null default '{}'::jsonb,
  status text not null check (status in ('completed', 'failed')),
  reply text,
  error_summary text,
  tool_calls text[] not null default '{}'::text[],
  loaded_skills text[] not null default '{}'::text[],
  model_provider text,
  model text,
  prompt_source text,
  prompt_version integer,
  duration_ms integer,
  trace_id text,
  created_at timestamptz not null default now(),
  unique (run_id, version_id)
);

create index agent_test_cases_user_agent_updated_idx
  on public.agent_test_cases(user_id, agent_type, updated_at desc);
create index agent_test_versions_case_position_idx
  on public.agent_test_versions(test_case_id, position);
create index agent_test_runs_case_started_idx
  on public.agent_test_runs(test_case_id, started_at desc);
create index agent_test_run_results_run_idx
  on public.agent_test_run_results(run_id);

create trigger agent_test_cases_set_updated_at
before update on public.agent_test_cases
for each row execute function public.set_sugar_agent_updated_at();

create trigger agent_test_versions_set_updated_at
before update on public.agent_test_versions
for each row execute function public.set_sugar_agent_updated_at();

alter table public.agent_test_cases enable row level security;
alter table public.agent_test_versions enable row level security;
alter table public.agent_test_runs enable row level security;
alter table public.agent_test_run_results enable row level security;

create policy agent_test_cases_owner_all on public.agent_test_cases
for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.project_members member
    where member.project_id = agent_test_cases.project_id
      and member.user_id = auth.uid()
  )
);

create policy agent_test_versions_owner_all on public.agent_test_versions
for all to authenticated
using (
  exists (
    select 1 from public.agent_test_cases test_case
    where test_case.id = agent_test_versions.test_case_id
      and test_case.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.agent_test_cases test_case
    where test_case.id = agent_test_versions.test_case_id
      and test_case.user_id = auth.uid()
  )
  and (
    model_config_id is null
    or exists (
      select 1 from public.user_model_configs config
      where config.id = model_config_id and config.user_id = auth.uid()
    )
  )
);

create policy agent_test_runs_owner_all on public.agent_test_runs
for all to authenticated
using (
  started_by = auth.uid()
  and exists (
    select 1 from public.agent_test_cases test_case
    where test_case.id = agent_test_runs.test_case_id
      and test_case.user_id = auth.uid()
  )
)
with check (
  started_by = auth.uid()
  and exists (
    select 1 from public.agent_test_cases test_case
    where test_case.id = agent_test_runs.test_case_id
      and test_case.user_id = auth.uid()
  )
);

create policy agent_test_run_results_owner_all on public.agent_test_run_results
for all to authenticated
using (
  exists (
    select 1
    from public.agent_test_runs test_run
    join public.agent_test_cases test_case on test_case.id = test_run.test_case_id
    where test_run.id = agent_test_run_results.run_id
      and test_case.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.agent_test_runs test_run
    join public.agent_test_cases test_case on test_case.id = test_run.test_case_id
    where test_run.id = agent_test_run_results.run_id
      and test_case.user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.agent_test_cases to authenticated;
grant select, insert, update, delete on public.agent_test_versions to authenticated;
grant select, insert, update, delete on public.agent_test_runs to authenticated;
grant select, insert, update, delete on public.agent_test_run_results to authenticated;

create or replace function public.resolve_user_model_config_by_id(
  p_user_id uuid,
  p_config_id uuid
)
returns table(provider text, model text, api_key text)
language sql
security definer
set search_path = public, vault
as $$
  select config.provider, config.model, secret.decrypted_secret
  from public.user_model_configs config
  join vault.decrypted_secrets secret on secret.id = config.api_key_secret_id
  where config.id = p_config_id and config.user_id = p_user_id;
$$;

revoke all on function public.resolve_user_model_config_by_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_user_model_config_by_id(uuid, uuid) to service_role;

commit;
