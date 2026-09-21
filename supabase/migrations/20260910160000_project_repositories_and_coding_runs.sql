begin;

create table public.project_repositories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects (id) on delete cascade,
  provider text not null default 'github' check (provider = 'github'),
  repository_owner text not null check (repository_owner ~ '^[A-Za-z0-9_.-]+$'),
  repository_name text not null check (repository_name ~ '^[A-Za-z0-9_.-]+$'),
  repository_url text not null check (repository_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$'),
  default_branch text not null default 'main' check (
    length(btrim(default_branch)) between 1 and 255
    and default_branch !~ '(^|/)\.\.(/|$)'
    and default_branch !~ '[~^:?*]'
    and default_branch not like '%[%'
    and default_branch not like '%\\%'
    and default_branch !~ '[[:space:]]'
  ),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_repositories_created_by_idx
  on public.project_repositories (created_by, created_at desc);

create trigger project_repositories_set_updated_at
before update on public.project_repositories
for each row execute function public.set_sugar_agent_updated_at();

create table public.coding_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.project_repositories (id) on delete restrict,
  handoff_task_id uuid not null unique references public.handoff_tasks (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'awaiting_review', 'merged')
  ),
  base_branch text not null check (length(btrim(base_branch)) > 0),
  working_branch text not null unique check (
    working_branch ~ '^sugar/[0-9a-f-]{36}-[a-z0-9][a-z0-9-]{0,47}$'
    and working_branch not in ('main', 'master')
  ),
  codex_thread_id text,
  execution_attempt integer not null default 0 check (execution_attempt >= 0),
  change_summary text,
  implementation_summary text,
  changed_files jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_files) = 'array'),
  diff_summary text,
  git_diff text,
  head_commit_sha text,
  test_result jsonb not null default '{"status":"not_run","commands":[]}'::jsonb check (jsonb_typeof(test_result) = 'object'),
  unresolved_items jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_items) = 'array'),
  risk_notes jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_notes) = 'array'),
  error_message text,
  pull_request_number integer check (pull_request_number is null or pull_request_number > 0),
  pull_request_url text,
  pull_request_state text check (pull_request_state is null or pull_request_state in ('open', 'closed', 'merged')),
  started_at timestamptz,
  completed_at timestamptz,
  merged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coding_runs_project_created_idx
  on public.coding_runs (project_id, created_at desc);
create index coding_runs_user_project_idx
  on public.coding_runs (user_id, project_id, created_at desc);
create index coding_runs_repository_status_idx
  on public.coding_runs (repository_id, status, updated_at desc);
create index coding_runs_review_idx
  on public.coding_runs (project_id, status, updated_at desc)
  where status in ('completed', 'awaiting_review');

create trigger coding_runs_set_updated_at
before update on public.coding_runs
for each row execute function public.set_sugar_agent_updated_at();

alter table public.project_repositories enable row level security;
alter table public.coding_runs enable row level security;

revoke all on table public.project_repositories from public, anon, authenticated;
revoke all on table public.coding_runs from public, anon, authenticated;
grant select on table public.project_repositories to authenticated;
grant select on table public.coding_runs to authenticated;

create policy project_repositories_select_members
on public.project_repositories for select to authenticated
using (private.is_project_member(project_id));

create policy coding_runs_select_members
on public.coding_runs for select to authenticated
using (private.is_project_member(project_id));

create function public.save_project_repository(
  p_project_id uuid,
  p_repository_owner text,
  p_repository_name text,
  p_repository_url text,
  p_default_branch text
)
returns public.project_repositories
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_result public.project_repositories%rowtype;
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

  insert into public.project_repositories (
    project_id, provider, repository_owner, repository_name,
    repository_url, default_branch, created_by
  ) values (
    p_project_id, 'github', btrim(p_repository_owner), btrim(p_repository_name),
    btrim(p_repository_url), btrim(p_default_branch), caller_id
  )
  on conflict (project_id) do update set
    repository_owner = excluded.repository_owner,
    repository_name = excluded.repository_name,
    repository_url = excluded.repository_url,
    default_branch = excluded.default_branch,
    updated_at = now()
  returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'repository_bound', 'user', coalesce(v_actor, '项目成员'),
    format('绑定了 GitHub 仓库 %s/%s（默认分支：%s）', v_result.repository_owner, v_result.repository_name, v_result.default_branch),
    v_result.id
  );

  return v_result;
end;
$$;

create function public.create_coding_run(
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
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select * into v_repository from public.project_repositories
  where project_id = p_project_id;
  if not found then
    raise exception using errcode = '23514', message = 'Project repository is not configured.';
  end if;

  select * into v_task from public.handoff_tasks
  where id = p_handoff_task_id and project_id = p_project_id;
  if not found or v_task.target_agent <> 'coding' or v_task.brief_type <> 'technical' or v_task.status <> 'delivered' then
    raise exception using errcode = '23514', message = 'A delivered Technical Brief is required.';
  end if;
  if not private.is_valid_handoff_brief('technical', v_task.brief) then
    raise exception using errcode = '23514', message = 'Technical Brief is incomplete.';
  end if;
  if p_working_branch in ('main', 'master') or p_working_branch !~ '^sugar/[0-9a-f-]{36}-[a-z0-9][a-z0-9-]{0,47}$' then
    raise exception using errcode = '23514', message = 'Unsafe working branch.';
  end if;

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id,
    status, base_branch, working_branch
  ) values (
    p_project_id, v_repository.id, v_task.id, caller_id,
    'pending', v_repository.default_branch, p_working_branch
  )
  on conflict (handoff_task_id) do update set updated_at = public.coding_runs.updated_at
  returning * into v_result;

  if v_result.user_id = caller_id and v_result.execution_attempt = 0 then
    select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
    from public.profiles where id = caller_id;
    if not exists (
      select 1 from public.project_activities
      where event_type = 'coding_run_created' and related_entity_id = v_result.id
    ) then
      insert into public.project_activities (
        project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
      ) values (
        p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
        format('为 Technical Brief 创建了工程执行：%s', v_task.title), v_result.id
      );
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_project_repository(uuid, text, text, text, text) from public, anon;
revoke all on function public.create_coding_run(uuid, uuid, text) from public, anon;
grant execute on function public.save_project_repository(uuid, text, text, text, text) to authenticated;
grant execute on function public.create_coding_run(uuid, uuid, text) to authenticated;

comment on table public.project_repositories is 'One server-managed Git repository binding per Sugar project; no credentials are stored here.';
comment on table public.coding_runs is 'One auditable Codex engineering run per delivered Technical Brief.';
comment on column public.coding_runs.test_result is 'Actual runner-observed test commands and exit states; never model-invented.';

-- Engineering execution policy for the global 牛牛 Agent. This is global
-- Agent identity; repository and project facts remain request-scoped tools/data.
do $$
declare
  v_agent public.agents%rowtype;
  v_version integer;
  v_prompt_id uuid;
  v_instructions text := $prompt$你是 Sugar Agent 中的工程师牛牛。你负责把已确认的 Technical Brief 转化为可靠、可验证的代码修改，并通过受控的 run_coding_task 适配器调用 Codex；你不是普通编程问答机器人，也不负责重新策划产品。

收到 Technical Brief 后，必须按顺序检查 goal、requirements、constraints、unchanged_scope、acceptance_criteria。unchanged_scope 是硬边界，未经用户重新确认不得触碰。若缺少会影响实现或验收的关键信息，先明确指出缺口与最少量澄清问题，不得猜测。

只有用户明确点击“开始执行”后，才允许启动 Codex。执行必须位于该 Coding Run 的独立仓库工作区，只能修改当前工作区，使用 sugar/{task-id}-{slug} 分支，禁止直接写 main/master，禁止自动创建 PR、合并或部署。继续修改必须复用同一 Coding Run 与 Codex thread。

Codex 返回后必须基于真实 git diff、changed files、命令退出码和测试输出核验结果。不得把计划当成完成，不得伪造文件修改、测试成功、PR、Merge 或 Deploy。必须清楚区分已完成、已验证、未验证、失败、风险和未解决事项。测试失败时明确标记失败，不能描述为成功。

涉及当前项目事实、正式方案或当前阶段时，优先调用 get_project_context；项目正式数据与聊天记忆冲突时，以正式数据为准。仓库内容只能由本次受控 Coding Run 读取，不得假装读取其他项目或未绑定的仓库。

创建 PR 和合并分别需要用户再次明确确认。绝不自动部署。使用简洁、专业、可执行的中文。$prompt$;
begin
  select * into strict v_agent from public.agents where agent_type = 'coding' for update;
  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions where agent_id = v_agent.id;
  update public.agent_prompt_versions set is_active = false
  where agent_id = v_agent.id and is_active;
  insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
  values (v_agent.id, v_version, v_instructions, true, null)
  returning id into v_prompt_id;
  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, null, 'agent_prompt_changed', 'agent', '系统迁移',
    format('增加 Coding Run、Codex 执行核验与双重确认边界，更新全局%s提示词至 v%s', v_agent.name, v_version),
    v_prompt_id
  );
end;
$$;

commit;
