begin;

-- A Codex run may now come from either a confirmed Xiaohua handoff or an
-- explicit instruction in the user's Niuniu conversation. The normalized
-- execution request keeps the runner independent from either source format.
alter table public.coding_runs
  drop constraint if exists coding_runs_handoff_task_id_key;

alter table public.coding_runs
  alter column handoff_task_id drop not null,
  add column source_kind text not null default 'xiaohua_handoff'
    check (source_kind in ('xiaohua_handoff', 'niuniu_conversation')),
  add column source_thread_id uuid references public.agent_threads(id) on delete set null,
  add column source_message_id uuid references public.messages(id) on delete set null,
  add column execution_request jsonb not null default '{}'::jsonb;

update public.coding_runs as run
set execution_request = jsonb_build_object(
  'title', task.title,
  'instruction', coalesce(nullif(task.brief->>'goal', ''), task.content),
  'background', coalesce(task.brief->>'background', ''),
  'requirements', coalesce(task.brief->'requirements', '[]'::jsonb),
  'constraints', coalesce(task.brief->'constraints', '[]'::jsonb),
  'unchangedScope', coalesce(task.brief->'unchanged_scope', '[]'::jsonb),
  'acceptanceCriteria', coalesce(task.brief->'acceptance_criteria', '[]'::jsonb),
  'sourcePlanVersion', task.brief->'source_plan_version'
)
from public.handoff_tasks as task
where task.id = run.handoff_task_id;

alter table public.coding_runs
  add constraint coding_runs_source_check check (
    (source_kind = 'xiaohua_handoff' and handoff_task_id is not null)
    or
    (source_kind = 'niuniu_conversation' and handoff_task_id is null
      and source_thread_id is not null and source_message_id is not null)
  ),
  add constraint coding_runs_execution_request_check check (
    jsonb_typeof(execution_request) = 'object'
    and nullif(btrim(execution_request->>'title'), '') is not null
    and nullif(btrim(execution_request->>'instruction'), '') is not null
  );

create unique index coding_runs_handoff_task_unique
  on public.coding_runs(handoff_task_id) where handoff_task_id is not null;
create unique index coding_runs_conversation_message_unique
  on public.coding_runs(user_id, source_message_id)
  where source_kind = 'niuniu_conversation';
create index coding_runs_source_thread_idx
  on public.coding_runs(source_thread_id, created_at desc)
  where source_thread_id is not null;

create or replace function public.create_local_coding_run(
  p_project_id uuid,
  p_handoff_task_id uuid,
  p_current_branch text
)
returns public.coding_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_repository public.project_repositories%rowtype;
  v_workspace public.user_project_repository_workspaces%rowtype;
  v_task public.handoff_tasks%rowtype;
  v_result public.coding_runs%rowtype;
  v_actor text;
  v_request jsonb;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not exists (select 1 from public.project_members where project_id = p_project_id and user_id = caller_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  select * into v_repository from public.project_repositories where project_id = p_project_id and provider = 'local_git';
  if not found then raise exception using errcode = '23514', message = 'Project repository is not configured.'; end if;
  select * into v_workspace from public.user_project_repository_workspaces
  where project_id = p_project_id and user_id = caller_id;
  if not found then raise exception using errcode = '23514', message = 'User local repository workspace is not configured.'; end if;
  select * into v_task from public.handoff_tasks where id = p_handoff_task_id and project_id = p_project_id;
  if not found or v_task.target_agent <> 'coding' or v_task.status <> 'delivered' then
    raise exception using errcode = '23514', message = 'A confirmed engineering task is required.';
  end if;

  v_request := jsonb_build_object(
    'title', v_task.title,
    'instruction', coalesce(nullif(v_task.brief->>'goal', ''), v_task.content),
    'background', coalesce(v_task.brief->>'background', ''),
    'requirements', coalesce(v_task.brief->'requirements', '[]'::jsonb),
    'constraints', coalesce(v_task.brief->'constraints', '[]'::jsonb),
    'unchangedScope', coalesce(v_task.brief->'unchanged_scope', '[]'::jsonb),
    'acceptanceCriteria', coalesce(v_task.brief->'acceptance_criteria', '[]'::jsonb),
    'sourcePlanVersion', v_task.brief->'source_plan_version'
  );

  update public.user_project_repository_workspaces
  set current_branch = btrim(p_current_branch), updated_at = now()
  where id = v_workspace.id;

  select * into v_result from public.coding_runs
  where handoff_task_id = p_handoff_task_id;
  if found then return v_result; end if;

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id, status,
    base_branch, working_branch, task_summary, execution_mode, local_repository_path,
    source_kind, execution_request
  ) values (
    p_project_id, v_repository.id, v_task.id, caller_id, 'pending',
    coalesce(v_repository.default_branch, v_workspace.current_branch),
    btrim(p_current_branch), v_task.title, 'local_repository', v_workspace.local_repository_path,
    'xiaohua_handoff', v_request
  ) returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor from public.profiles where id = caller_id;
  insert into public.project_activities (project_id, user_id, event_type, actor_type, actor, summary, related_entity_id)
  values (p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
    format('把小花交办的工程任务交给 Codex：%s', v_task.title), v_result.id);
  return v_result;
end;
$$;

create function public.create_conversation_coding_run(
  p_project_id uuid,
  p_source_message_id uuid,
  p_title text,
  p_instruction text,
  p_current_branch text
)
returns public.coding_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_repository public.project_repositories%rowtype;
  v_workspace public.user_project_repository_workspaces%rowtype;
  v_thread public.agent_threads%rowtype;
  v_result public.coding_runs%rowtype;
  v_actor text;
  v_request jsonb;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not private.is_project_member(p_project_id) then raise exception using errcode = '42501', message = 'Project access denied.'; end if;
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_instruction), '') is null
     or length(btrim(p_title)) > 4000 or length(btrim(p_instruction)) > 12000 then
    raise exception using errcode = '23514', message = 'Invalid engineering instruction.';
  end if;

  select thread.* into v_thread
  from public.messages as message
  join public.agent_threads as thread on thread.id = message.thread_id
  where message.id = p_source_message_id
    and thread.project_id = p_project_id
    and thread.user_id = caller_id
    and thread.agent_type = 'coding';
  if not found then raise exception using errcode = '42501', message = 'Conversation source access denied.'; end if;

  select * into v_repository from public.project_repositories where project_id = p_project_id and provider = 'local_git';
  if not found then raise exception using errcode = '23514', message = 'Project repository is not configured.'; end if;
  select * into v_workspace from public.user_project_repository_workspaces
  where project_id = p_project_id and user_id = caller_id;
  if not found then raise exception using errcode = '23514', message = 'User local repository workspace is not configured.'; end if;

  update public.user_project_repository_workspaces
  set current_branch = btrim(p_current_branch), updated_at = now()
  where id = v_workspace.id;

  select * into v_result from public.coding_runs
  where user_id = caller_id and source_message_id = p_source_message_id;
  if found then return v_result; end if;

  v_request := jsonb_build_object(
    'title', btrim(p_title),
    'instruction', btrim(p_instruction),
    'background', '来自用户与工程师牛牛的当前对话。',
    'requirements', '[]'::jsonb,
    'constraints', '[]'::jsonb,
    'unchangedScope', jsonb_build_array('不要修改与本次明确指令无关的功能'),
    'acceptanceCriteria', jsonb_build_array('完成用户明确要求的修改并运行相关检查'),
    'sourcePlanVersion', null
  );

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id, status,
    base_branch, working_branch, task_summary, execution_mode, local_repository_path,
    source_kind, source_thread_id, source_message_id, execution_request
  ) values (
    p_project_id, v_repository.id, null, caller_id, 'pending',
    coalesce(v_repository.default_branch, v_workspace.current_branch),
    btrim(p_current_branch), btrim(p_title), 'local_repository', v_workspace.local_repository_path,
    'niuniu_conversation', v_thread.id, p_source_message_id, v_request
  ) returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor from public.profiles where id = caller_id;
  insert into public.project_activities (project_id, user_id, event_type, actor_type, actor, summary, related_entity_id)
  values (p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
    format('从牛牛对话启动 Codex 工程任务：%s', btrim(p_title)), v_result.id);
  return v_result;
end;
$$;

revoke all on function public.create_conversation_coding_run(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_conversation_coding_run(uuid, uuid, text, text, text) to authenticated;

comment on table public.coding_runs is 'Auditable Codex engineering runs started from a Xiaohua handoff or an explicit Niuniu conversation instruction.';
comment on column public.coding_runs.execution_request is 'Normalized confirmed engineering instruction sent to Codex; independent of the source UI.';

-- Replace the global Niuniu prompt without changing project or user scope.
do $$
declare
  v_agent public.agents%rowtype;
  v_version integer;
  v_instructions text := $prompt$你是 Sugar Agent 中的工程师牛牛，是用户、小花与 Codex 之间的工程工作入口。真正的代码理解、技术讨论和工程执行由 Codex 直接完成；不要在 Codex 外再模拟一层技术判断或结果审阅。

用户可以直接与你讨论技术问题和实现方案，也可以在当前对话中明确让 Codex 开始修改代码。制作人小花也可以把用户确认过的工程任务交给你。这两种入口地位相同，都不要求额外准备固定格式的任务文档。

讨论模式允许 Codex 只读分析已绑定仓库，不修改文件。只有用户点击明确的“开始修改代码”或确认执行操作后，才允许恢复同一个 Codex thread 并写入当前 working tree。执行时直接忠实采用用户确认的工程指令；若指令已有足够信息，不要增加无意义的流程门槛。

代码只能写入项目绑定的本地 Git Repository，并使用用户当前 checkout 的分支和 working tree。不得自动 checkout、创建或删除分支，不得自动 stash、reset、discard、commit、fetch、pull、push、rebase、合并或部署。发现已有未提交修改时必须展示文件并等待用户选择继续或取消。

Codex 完成后，向用户展示真实 git diff、文件列表、测试命令与退出状态。不得把计划当成完成，不得伪造修改或测试。Commit 和 Push 必须分别由用户确认。不得访问仓库外路径或输出任何环境变量、Supabase Secret、OpenAI Key。

使用简洁、清楚的中文，对非技术用户也要解释明白。讨论不等于执行，必须明确区分只读分析和已经写入的修改。$prompt$;
begin
  select * into strict v_agent from public.agents where agent_type = 'coding' for update;
  select coalesce(max(version), 0) + 1 into v_version from public.agent_prompt_versions where agent_id = v_agent.id;
  update public.agent_prompt_versions set is_active = false where agent_id = v_agent.id and is_active;
  insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
  values (v_agent.id, v_version, v_instructions, true, null);
  update public.agents set updated_at = now() where id = v_agent.id;
end;
$$;

commit;
