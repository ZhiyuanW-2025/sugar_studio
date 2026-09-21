begin;

create table public.handoff_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_agent text not null check (source_agent in ('planning', 'coding', 'design')),
  target_agent text not null check (target_agent in ('planning', 'coding', 'design')),
  source_thread_id uuid not null references public.agent_threads (id) on delete cascade,
  source_plan_version uuid references public.artifact_versions (id) on delete set null,
  target_thread_id uuid references public.agent_threads (id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  content text not null check (length(btrim(content)) > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'delivered')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  delivered_at timestamptz,
  constraint handoff_tasks_agents_differ check (source_agent <> target_agent)
);

create index handoff_tasks_project_created_idx
  on public.handoff_tasks (project_id, created_at desc);
create index handoff_tasks_created_by_target_idx
  on public.handoff_tasks (created_by, project_id, target_agent, created_at desc);
create index handoff_tasks_target_thread_idx
  on public.handoff_tasks (target_thread_id) where target_thread_id is not null;

alter table public.handoff_tasks enable row level security;
revoke all on table public.handoff_tasks from anon, authenticated;
grant select on table public.handoff_tasks to authenticated;

create policy handoff_tasks_select_members
on public.handoff_tasks for select to authenticated
using (private.is_project_member(project_id));

create function public.create_handoff_draft(
  p_project_id uuid,
  p_source_thread_id uuid,
  p_target_agent text,
  p_source_plan_version uuid,
  p_title text,
  p_content text
)
returns public.handoff_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_result public.handoff_tasks%rowtype;
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
  if p_target_agent not in ('coding', 'design')
     or nullif(btrim(p_title), '') is null
     or nullif(btrim(p_content), '') is null then
    raise exception using errcode = '23514', message = 'Invalid handoff draft.';
  end if;
  if not exists (
    select 1 from public.agent_threads
    where id = p_source_thread_id
      and project_id = p_project_id
      and user_id = caller_id
      and agent_type = 'planning'
  ) then
    raise exception using errcode = '42501', message = 'Source thread access denied.';
  end if;
  if p_source_plan_version is not null and not exists (
    select 1 from public.artifact_versions as version
    join public.artifacts as artifact on artifact.id = version.artifact_id
    where version.id = p_source_plan_version and artifact.project_id = p_project_id
  ) then
    raise exception using errcode = '42501', message = 'Plan version access denied.';
  end if;

  insert into public.handoff_tasks (
    project_id, source_agent, target_agent, source_thread_id, source_plan_version,
    title, content, status, created_by
  ) values (
    p_project_id, 'planning', p_target_agent, p_source_thread_id, p_source_plan_version,
    btrim(p_title), btrim(p_content), 'draft', caller_id
  ) returning * into v_result;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'handoff_task_created', 'agent', '策划师小花',
    format('为%s创建了交接任务草稿：%s', case p_target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end, btrim(p_title)),
    v_result.id
  );

  return v_result;
end;
$$;

create function public.approve_and_deliver_handoff(
  p_project_id uuid,
  p_handoff_id uuid,
  p_title text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_task public.handoff_tasks%rowtype;
  v_thread public.agent_threads%rowtype;
  v_actor text;
  v_target_name text;
  v_message text;
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
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_content), '') is null then
    raise exception using errcode = '23514', message = 'Handoff content is required.';
  end if;

  select * into v_task from public.handoff_tasks
  where id = p_handoff_id and project_id = p_project_id
  for update;
  if not found or v_task.created_by <> caller_id then
    raise exception using errcode = '42501', message = 'Handoff access denied.';
  end if;
  if v_task.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Handoff was already processed.';
  end if;

  update public.handoff_tasks
  set title = btrim(p_title), content = btrim(p_content), status = 'approved', approved_at = now()
  where id = v_task.id;

  insert into public.agent_threads (project_id, user_id, agent_type, title)
  values (
    p_project_id,
    caller_id,
    v_task.target_agent,
    case v_task.target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end
  )
  on conflict (user_id, project_id, agent_type)
  do update set updated_at = now()
  returning * into v_thread;

  v_target_name := case v_task.target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end;
  v_message := format('【来自策划师小花的交接任务】\n%s\n\n%s', btrim(p_title), btrim(p_content));

  insert into public.messages (thread_id, request_id, role, content)
  values (v_thread.id, v_task.id, 'system', v_message);

  update public.handoff_tasks
  set status = 'delivered', target_thread_id = v_thread.id, delivered_at = now()
  where id = v_task.id;

  update public.agent_threads set updated_at = now() where id = v_thread.id;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values
    (p_project_id, caller_id, 'handoff_task_approved', 'user', coalesce(v_actor, '项目成员'), format('批准了交接任务：%s', btrim(p_title)), v_task.id),
    (p_project_id, caller_id, 'handoff_task_delivered', 'user', coalesce(v_actor, '项目成员'), format('将任务发送给%s：%s', v_target_name, btrim(p_title)), v_task.id);

  return jsonb_build_object(
    'taskId', v_task.id,
    'targetAgent', v_task.target_agent,
    'targetThreadId', v_thread.id,
    'title', btrim(p_title),
    'content', btrim(p_content),
    'message', v_message
  );
end;
$$;

revoke all on function public.create_handoff_draft(uuid, uuid, text, uuid, text, text) from public, anon;
revoke all on function public.approve_and_deliver_handoff(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_handoff_draft(uuid, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.approve_and_deliver_handoff(uuid, uuid, text, text) to authenticated;

comment on table public.handoff_tasks is 'User-confirmed task handoffs between independent Sugar Agent threads.';

commit;
