begin;

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  agent_type text not null check (agent_type in ('planning', 'coding', 'design')),
  name text not null check (length(btrim(name)) > 0),
  role_title text not null check (length(btrim(role_title)) > 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, agent_type)
);

create table public.agent_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  version integer not null check (version > 0),
  instructions text not null check (length(btrim(instructions)) > 0),
  is_active boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create unique index agent_prompt_versions_one_active_idx
  on public.agent_prompt_versions (agent_id)
  where is_active;

create index agents_project_id_idx on public.agents (project_id, agent_type);
create index agent_prompt_versions_history_idx
  on public.agent_prompt_versions (agent_id, version desc);

create trigger agents_set_updated_at
before update on public.agents
for each row execute function public.set_sugar_agent_updated_at();

create function private.seed_project_agents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agents (project_id, agent_type, name, role_title, description)
  values
    (new.id, 'planning', '策划师小花', '策划师', '负责研究、活动概念、路线、机制、谜题与策划成果整理。'),
    (new.id, 'coding', '工程师牛牛', '工程师', '负责理解技术任务、拆解实现路径并识别开发风险。'),
    (new.id, 'design', '艺术家小熊', '艺术家', '负责理解视觉任务、提出视觉方向并整理执行方案。')
  on conflict (project_id, agent_type) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_project_agents() from public, anon, authenticated;

create trigger projects_seed_agents
after insert on public.projects
for each row execute function private.seed_project_agents();

insert into public.agents (project_id, agent_type, name, role_title, description)
select project.id, definition.agent_type, definition.name, definition.role_title, definition.description
from public.projects as project
cross join (
  values
    ('planning', '策划师小花', '策划师', '负责研究、活动概念、路线、机制、谜题与策划成果整理。'),
    ('coding', '工程师牛牛', '工程师', '负责理解技术任务、拆解实现路径并识别开发风险。'),
    ('design', '艺术家小熊', '艺术家', '负责理解视觉任务、提出视觉方向并整理执行方案。')
) as definition(agent_type, name, role_title, description)
on conflict (project_id, agent_type) do nothing;

create function private.can_access_agent(target_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agents as agent
    join public.project_members as membership
      on membership.project_id = agent.project_id
     and membership.user_id = (select auth.uid())
    where agent.id = target_agent_id
  );
$$;

revoke all on function private.can_access_agent(uuid) from public, anon;
grant execute on function private.can_access_agent(uuid) to authenticated;

alter table public.agents enable row level security;
alter table public.agent_prompt_versions enable row level security;

create policy agents_select_members
on public.agents for select to authenticated
using (private.is_project_member(project_id));

create policy agent_prompt_versions_select_members
on public.agent_prompt_versions for select to authenticated
using (private.can_access_agent(agent_id));

revoke all on table public.agents from anon, authenticated;
revoke all on table public.agent_prompt_versions from anon, authenticated;
grant select on table public.agents to authenticated;
grant select on table public.agent_prompt_versions to authenticated;

create function public.save_agent_prompt(
  p_project_id uuid,
  p_agent_type text,
  p_instructions text
)
returns public.agent_prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_agent public.agents%rowtype;
  v_version integer;
  v_result public.agent_prompt_versions%rowtype;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_agent_type not in ('planning', 'coding', 'design')
     or nullif(btrim(p_instructions), '') is null then
    raise exception using errcode = '23514', message = 'Invalid prompt.';
  end if;

  select * into v_agent from public.agents
  where project_id = p_project_id and agent_type = p_agent_type
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions where agent_id = v_agent.id;

  update public.agent_prompt_versions set is_active = false
  where agent_id = v_agent.id and is_active;

  insert into public.agent_prompt_versions (
    agent_id, version, instructions, is_active, created_by
  ) values (
    v_agent.id, v_version, btrim(p_instructions), true, caller_id
  ) returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'agent_prompt_changed', 'user', coalesce(v_actor, '项目成员'),
    format('更新了%s提示词至 v%s', v_agent.name, v_version), v_result.id
  );

  return v_result;
end;
$$;

create function public.rollback_agent_prompt(
  p_project_id uuid,
  p_agent_type text,
  p_target_version integer
)
returns public.agent_prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_agent public.agents%rowtype;
  v_target public.agent_prompt_versions%rowtype;
  v_version integer;
  v_result public.agent_prompt_versions%rowtype;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select * into v_agent from public.agents
  where project_id = p_project_id and agent_type = p_agent_type
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;

  select * into v_target from public.agent_prompt_versions
  where agent_id = v_agent.id and version = p_target_version;
  if not found then
    raise exception using errcode = 'P0002', message = 'Prompt version not found.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions where agent_id = v_agent.id;

  update public.agent_prompt_versions set is_active = false
  where agent_id = v_agent.id and is_active;

  insert into public.agent_prompt_versions (
    agent_id, version, instructions, is_active, created_by
  ) values (
    v_agent.id, v_version, v_target.instructions, true, caller_id
  ) returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'agent_prompt_rolled_back', 'user', coalesce(v_actor, '项目成员'),
    format('将%s提示词回滚到 v%s，并创建 v%s', v_agent.name, p_target_version, v_version), v_result.id
  );

  return v_result;
end;
$$;

revoke all on function public.save_agent_prompt(uuid, text, text) from public, anon;
revoke all on function public.rollback_agent_prompt(uuid, text, integer) from public, anon;
grant execute on function public.save_agent_prompt(uuid, text, text) to authenticated;
grant execute on function public.rollback_agent_prompt(uuid, text, integer) to authenticated;

comment on table public.agents is 'Project-scoped specialist Agent definitions.';
comment on table public.agent_prompt_versions is 'Immutable project Agent instruction versions; rollback creates a new version.';

commit;
