begin;

-- Workspace-level, editable descriptions of the tools an Agent can use.
-- Editing this table changes the Agent's operating documentation; it does not
-- grant a new server capability. Executable tools remain allow-listed in code.
create table public.agent_tool_configs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  slug text not null check (length(btrim(slug)) between 2 and 96 and slug ~ '^[a-z0-9_]+$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  implementation text not null default '' check (length(implementation) <= 20000),
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object'),
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, slug)
);

create index agent_tool_configs_agent_status_idx
  on public.agent_tool_configs(agent_id, status, updated_at desc);

create table public.agent_general_knowledge (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  content text not null check (length(btrim(content)) between 1 and 30000),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_general_knowledge_agent_status_idx
  on public.agent_general_knowledge(agent_id, status, updated_at desc);

create trigger agent_tool_configs_set_updated_at
before update on public.agent_tool_configs
for each row execute function public.set_sugar_agent_updated_at();

create trigger agent_general_knowledge_set_updated_at
before update on public.agent_general_knowledge
for each row execute function public.set_sugar_agent_updated_at();

alter table public.agent_tool_configs enable row level security;
alter table public.agent_general_knowledge enable row level security;

create policy agent_tool_configs_workspace_members
on public.agent_tool_configs for all to authenticated
using (private.is_workspace_member())
with check (private.is_workspace_member());

create policy agent_general_knowledge_workspace_members
on public.agent_general_knowledge for all to authenticated
using (private.is_workspace_member())
with check (private.is_workspace_member());

grant select, insert, update, delete on table public.agent_tool_configs to authenticated;
grant select, insert, update, delete on table public.agent_general_knowledge to authenticated;
grant all on table public.agent_tool_configs to service_role;
grant all on table public.agent_general_knowledge to service_role;

alter table public.agent_config_activities
  drop constraint if exists agent_config_activities_event_type_check;

alter table public.agent_config_activities
  add constraint agent_config_activities_event_type_check
  check (event_type in (
    'agent_prompt_changed', 'agent_prompt_rolled_back', 'agent_avatar_changed', 'agent_avatar_reset',
    'agent_skill_created', 'agent_skill_version_created', 'agent_skill_status_changed',
    'agent_skill_rolled_back', 'agent_skill_deleted', 'agent_tool_changed', 'agent_knowledge_changed'
  ));

comment on table public.agent_tool_configs is
  'Workspace-level editable Agent tool documentation and input schemas. Server execution remains code allow-listed.';
comment on table public.agent_general_knowledge is
  'Workspace-level reusable knowledge that teaches one Agent how to perform its role.';

commit;
