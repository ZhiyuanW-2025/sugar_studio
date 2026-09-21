begin;

-- Capture every distinct historical prompt before replacing the original
-- project-scoped Agent catalog. Existing content and authorship are retained.
create temporary table migration_agent_definitions on commit drop as
select distinct on (agent.agent_type)
  agent.agent_type,
  agent.name,
  agent.role_title,
  agent.description,
  agent.created_at,
  agent.updated_at
from public.agents as agent
order by agent.agent_type, agent.created_at, agent.id;

create temporary table migration_prompt_history on commit drop as
select
  agent.agent_type,
  prompt.instructions,
  prompt.created_by,
  prompt.created_at,
  prompt.id as legacy_prompt_id
from public.agent_prompt_versions as prompt
join public.agents as agent on agent.id = prompt.agent_id;

-- Prefer the active prompt used by 梧桐无同. If it does not exist, preserve
-- the most recently active project copy as the initial global active prompt.
create temporary table migration_active_prompts on commit drop as
select distinct on (agent.agent_type)
  agent.agent_type,
  prompt.instructions
from public.agent_prompt_versions as prompt
join public.agents as agent on agent.id = prompt.agent_id
join public.projects as project on project.id = agent.project_id
where prompt.is_active
order by
  agent.agent_type,
  (project.name = '梧桐无同') desc,
  prompt.created_at desc,
  prompt.id desc;

create temporary table migration_prompt_activities on commit drop as
select
  activity.user_id,
  activity.event_type,
  activity.actor_type,
  activity.actor,
  activity.summary,
  activity.created_at,
  agent.agent_type
from public.project_activities as activity
left join public.agent_prompt_versions as prompt
  on prompt.id = activity.related_entity_id
left join public.agents as agent on agent.id = prompt.agent_id
where activity.event_type in ('agent_prompt_changed', 'agent_prompt_rolled_back');

-- Prompt changes are workspace configuration events, not project events.
delete from public.project_activities
where event_type in ('agent_prompt_changed', 'agent_prompt_rolled_back');

drop trigger if exists projects_seed_agents on public.projects;
drop function if exists public.save_agent_prompt(uuid, text, text);
drop function if exists public.rollback_agent_prompt(uuid, text, integer);
drop table public.agent_prompt_versions;
drop table public.agents;
drop function if exists private.can_access_agent(uuid);
drop function if exists private.seed_project_agents();

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null unique check (agent_type in ('planning', 'coding', 'design')),
  name text not null check (length(btrim(name)) > 0),
  role_title text not null check (length(btrim(role_title)) > 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
create index agent_prompt_versions_history_idx
  on public.agent_prompt_versions (agent_id, version desc);

create table public.agent_config_activities (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('agent_prompt_changed', 'agent_prompt_rolled_back')),
  actor_type text not null default 'user' check (actor_type in ('user', 'agent')),
  actor text not null check (length(btrim(actor)) > 0),
  summary text not null check (length(btrim(summary)) > 0),
  related_entity_id uuid,
  created_at timestamptz not null default now()
);

create index agent_config_activities_created_at_idx
  on public.agent_config_activities (created_at desc);
create index agent_config_activities_agent_created_idx
  on public.agent_config_activities (agent_id, created_at desc);

create trigger agents_set_updated_at
before update on public.agents
for each row execute function public.set_sugar_agent_updated_at();

insert into public.agents (
  agent_type, name, role_title, description, created_at, updated_at
)
select
  fallback.agent_type,
  coalesce(definition.name, fallback.name),
  coalesce(definition.role_title, fallback.role_title),
  coalesce(definition.description, fallback.description),
  coalesce(definition.created_at, now()),
  coalesce(definition.updated_at, now())
from (
  values
    ('planning', '策划师小花', '策划师', '负责研究、活动概念、路线、机制、谜题与策划成果整理。'),
    ('coding', '工程师牛牛', '工程师', '负责理解技术任务、拆解实现路径并识别开发风险。'),
    ('design', '艺术家小熊', '艺术家', '负责理解视觉任务、提出视觉方向并整理执行方案。')
) as fallback(agent_type, name, role_title, description)
left join migration_agent_definitions as definition
  on definition.agent_type = fallback.agent_type;

-- Merge project copies into one immutable history per global Agent. Identical
-- seeded copies are deduplicated by instruction content.
with distinct_history as (
  select distinct on (history.agent_type, history.instructions)
    history.agent_type,
    history.instructions,
    history.created_by,
    history.created_at,
    history.legacy_prompt_id
  from migration_prompt_history as history
  order by
    history.agent_type,
    history.instructions,
    history.created_at,
    history.legacy_prompt_id
), numbered_history as (
  select
    history.*,
    row_number() over (
      partition by history.agent_type
      order by history.created_at, history.legacy_prompt_id
    )::integer as version
  from distinct_history as history
)
insert into public.agent_prompt_versions (
  agent_id, version, instructions, is_active, created_by, created_at
)
select
  agent.id,
  history.version,
  history.instructions,
  false,
  history.created_by,
  history.created_at
from numbered_history as history
join public.agents as agent on agent.agent_type = history.agent_type;

-- Defensive defaults cover installations where an Agent had no stored prompt.
insert into public.agent_prompt_versions (
  agent_id, version, instructions, is_active, created_by
)
select
  agent.id,
  1,
  case agent.agent_type
    when 'planning' then '你是 Sugar Agent 中的策划师小花。负责活动研究、概念、路线、点位、谜题、互动机制、玩家体验与策划成果整理。涉及项目事实时必须调用 get_project_context。不得未经用户确认保存正式方案或向其他 Agent 发送任务。使用简洁、直接、自然的中文。'
    when 'coding' then '你是 Sugar Agent 中的工程师牛牛。负责理解技术任务、拆解实施步骤、发现需求缺失和技术风险，输出技术实施方案。不得擅自修改策划或扩大需求，当前不调用 Codex。涉及项目事实时必须调用 get_project_context。使用直接、专业、可执行的中文。'
    when 'design' then '你是 Sugar Agent 中的艺术家小熊。负责理解视觉任务、提出视觉方向、整理图片生成 Prompt 和视觉执行方案。不得擅自修改活动机制，当前不生成图片。涉及项目事实时必须调用 get_project_context。使用具体、克制、可执行的中文。'
  end,
  true,
  null
from public.agents as agent
where not exists (
  select 1 from public.agent_prompt_versions as prompt
  where prompt.agent_id = agent.id
);

-- Activate the selected former project prompt. If no project copy was marked
-- active, the most recent preserved version becomes active.
update public.agent_prompt_versions as prompt
set is_active = true
from public.agents as agent
join migration_active_prompts as selected
  on selected.agent_type = agent.agent_type
where prompt.agent_id = agent.id
  and prompt.instructions = selected.instructions;

update public.agent_prompt_versions as prompt
set is_active = true
where prompt.id in (
  select latest.id
  from public.agents as agent
  join lateral (
    select candidate.id
    from public.agent_prompt_versions as candidate
    where candidate.agent_id = agent.id
    order by candidate.version desc
    limit 1
  ) as latest on true
  where not exists (
    select 1 from public.agent_prompt_versions as active
    where active.agent_id = agent.id and active.is_active
  )
);

insert into public.agent_config_activities (
  agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id, created_at
)
select
  agent.id,
  activity.user_id,
  activity.event_type,
  activity.actor_type,
  activity.actor,
  activity.summary,
  null,
  activity.created_at
from migration_prompt_activities as activity
join public.agents as agent on agent.agent_type = activity.agent_type;

create function private.is_workspace_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_workspace_member() from public, anon;
grant execute on function private.is_workspace_member() to authenticated;

alter table public.agents enable row level security;
alter table public.agent_prompt_versions enable row level security;
alter table public.agent_config_activities enable row level security;

create policy agents_select_workspace_members
on public.agents for select to authenticated
using (private.is_workspace_member());

create policy agent_prompt_versions_select_workspace_members
on public.agent_prompt_versions for select to authenticated
using (private.is_workspace_member());

create policy agent_config_activities_select_workspace_members
on public.agent_config_activities for select to authenticated
using (private.is_workspace_member());

revoke all on table public.agents from anon, authenticated;
revoke all on table public.agent_prompt_versions from anon, authenticated;
revoke all on table public.agent_config_activities from anon, authenticated;
grant select on table public.agents to authenticated;
grant select on table public.agent_prompt_versions to authenticated;
grant select on table public.agent_config_activities to authenticated;

create function public.save_agent_prompt(
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
  if not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_agent_type not in ('planning', 'coding', 'design')
     or nullif(btrim(p_instructions), '') is null then
    raise exception using errcode = '23514', message = 'Invalid prompt.';
  end if;

  select * into v_agent from public.agents
  where agent_type = p_agent_type
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

  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_prompt_changed', 'user', coalesce(v_actor, '工作室成员'),
    format('更新了全局%s提示词至 v%s', v_agent.name, v_version), v_result.id
  );

  return v_result;
end;
$$;

create function public.rollback_agent_prompt(
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
  if not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;

  select * into v_agent from public.agents
  where agent_type = p_agent_type
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

  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_prompt_rolled_back', 'user', coalesce(v_actor, '工作室成员'),
    format('将全局%s提示词回滚到 v%s，并创建 v%s', v_agent.name, p_target_version, v_version), v_result.id
  );

  return v_result;
end;
$$;

revoke all on function public.save_agent_prompt(text, text) from public, anon;
revoke all on function public.rollback_agent_prompt(text, integer) from public, anon;
grant execute on function public.save_agent_prompt(text, text) to authenticated;
grant execute on function public.rollback_agent_prompt(text, integer) to authenticated;

comment on table public.agents is 'Workspace-global specialist Agent definitions; exactly one row per agent_type.';
comment on table public.agent_prompt_versions is 'Immutable workspace-global Agent instructions. Project-specific additional instructions may be layered separately in the future.';
comment on table public.agent_config_activities is 'Workspace-level audit history for global Agent configuration changes.';

commit;
