begin;

alter table public.coding_runs
  add column task_summary text not null default '',
  add column result_summary text,
  add column file_summaries jsonb not null default '[]'::jsonb check (jsonb_typeof(file_summaries) = 'array'),
  add column error_summary text;

update public.coding_runs as run
set task_summary = task.title
from public.handoff_tasks as task
where task.id = run.handoff_task_id;

create or replace function private.is_executable_technical_brief(p_brief jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.is_valid_handoff_brief('technical', p_brief)
    and jsonb_array_length(p_brief->'requirements') > 0
    and jsonb_array_length(p_brief->'acceptance_criteria') > 0;
$$;

create or replace function public.create_coding_run(
  p_project_id uuid,
  p_handoff_task_id uuid,
  p_working_branch text
)
returns public.coding_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_repository public.project_repositories%rowtype;
  v_task public.handoff_tasks%rowtype;
  v_result public.coding_runs%rowtype;
  v_actor text;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not exists (select 1 from public.project_members where project_id = p_project_id and user_id = caller_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  select * into v_repository from public.project_repositories where project_id = p_project_id;
  if not found then raise exception using errcode = '23514', message = 'Project repository is not configured.'; end if;
  select * into v_task from public.handoff_tasks where id = p_handoff_task_id and project_id = p_project_id;
  if not found or v_task.target_agent <> 'coding' or v_task.brief_type <> 'technical' or v_task.status <> 'delivered' then
    raise exception using errcode = '23514', message = 'A delivered Technical Brief is required.';
  end if;
  if not private.is_executable_technical_brief(v_task.brief) then
    raise exception using errcode = '23514', message = 'Technical Brief is incomplete.';
  end if;
  if p_working_branch in ('main', 'master') or p_working_branch !~ '^sugar/[0-9a-f-]{36}-[a-z0-9][a-z0-9-]{0,47}$' then
    raise exception using errcode = '23514', message = 'Unsafe working branch.';
  end if;

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id,
    status, base_branch, working_branch, task_summary
  ) values (
    p_project_id, v_repository.id, v_task.id, caller_id,
    'pending', v_repository.default_branch, p_working_branch, v_task.title
  )
  on conflict (handoff_task_id) do update set updated_at = public.coding_runs.updated_at
  returning * into v_result;

  if v_result.user_id = caller_id and v_result.execution_attempt = 0 and not exists (
    select 1 from public.project_activities where event_type = 'coding_run_created' and related_entity_id = v_result.id
  ) then
    select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor from public.profiles where id = caller_id;
    insert into public.project_activities (
      project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
    ) values (
      p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
      format('为 Technical Brief 创建了工程执行：%s', v_task.title), v_result.id
    );
  end if;
  return v_result;
end;
$$;

comment on function private.is_executable_technical_brief(jsonb)
  is 'Stricter execution gate: an otherwise valid Technical Brief must contain at least one requirement and acceptance criterion.';

commit;
