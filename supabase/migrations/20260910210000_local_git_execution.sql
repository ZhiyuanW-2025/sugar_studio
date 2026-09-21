begin;

alter table public.project_repositories
  alter column provider set default 'local_git',
  alter column repository_owner drop not null,
  alter column repository_name drop not null,
  alter column repository_url drop not null,
  alter column default_branch drop not null,
  add column local_repository_path text,
  add column remote_name text not null default 'origin',
  add column remote_url text,
  add column current_branch text;

alter table public.project_repositories drop constraint if exists project_repositories_provider_check;
alter table public.project_repositories drop constraint if exists project_repositories_repository_owner_check;
alter table public.project_repositories drop constraint if exists project_repositories_repository_name_check;
alter table public.project_repositories drop constraint if exists project_repositories_repository_url_check;
alter table public.project_repositories add constraint project_repositories_provider_check
  check (provider in ('local_git', 'github', 'gitlab', 'gitea', 'self_hosted'));
alter table public.project_repositories add constraint project_repositories_local_path_check
  check (provider <> 'local_git' or (
    local_repository_path is not null
    and length(btrim(local_repository_path)) between 2 and 2048
    and left(btrim(local_repository_path), 1) = '/'
  ));
alter table public.project_repositories add constraint project_repositories_remote_name_check
  check (remote_name ~ '^[A-Za-z0-9._-]+$');
alter table public.project_repositories add constraint project_repositories_current_branch_check
  check (current_branch is null or (
    length(btrim(current_branch)) between 1 and 255
    and current_branch !~ '(^|/)\.\.(/|$)'
    and current_branch !~ '[~^:?*]'
    and current_branch not like '%[%'
    and current_branch not like '%\\%'
    and current_branch !~ '[[:space:]]'
  ));

-- The former RPCs accepted GitHub coordinates and generated sugar/* branches.
-- Removing them prevents older clients from bypassing the local repository flow.
drop function if exists public.save_project_repository(uuid, text, text, text, text);
drop function if exists public.create_coding_run(uuid, uuid, text);

alter table public.coding_runs drop constraint if exists coding_runs_working_branch_check;
alter table public.coding_runs drop constraint if exists coding_runs_working_branch_key;
alter table public.coding_runs
  add column execution_mode text not null default 'local_repository'
    check (execution_mode in ('local_repository')),
  add column local_repository_path text,
  add column branch_before text,
  add column head_before text,
  add column working_tree_before jsonb not null default '[]'::jsonb
    check (jsonb_typeof(working_tree_before) = 'array'),
  add column branch_after text,
  add column head_after text,
  add column working_tree_after jsonb not null default '[]'::jsonb
    check (jsonb_typeof(working_tree_after) = 'array'),
  add column commit_sha text,
  add column push_status text not null default 'not_requested'
    check (push_status in ('not_requested', 'pending_confirmation', 'succeeded', 'failed'));

create or replace function public.save_local_project_repository(
  p_project_id uuid,
  p_local_repository_path text,
  p_remote_name text,
  p_remote_url text,
  p_current_branch text,
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
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not exists (
    select 1 from public.project_members where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  insert into public.project_repositories (
    project_id, provider, repository_owner, repository_name, repository_url,
    local_repository_path, remote_name, remote_url, current_branch,
    default_branch, created_by
  ) values (
    p_project_id, 'local_git', null, null, null,
    btrim(p_local_repository_path), btrim(p_remote_name), nullif(btrim(p_remote_url), ''),
    btrim(p_current_branch), nullif(btrim(p_default_branch), ''), caller_id
  )
  on conflict (project_id) do update set
    provider = excluded.provider,
    repository_owner = null,
    repository_name = null,
    repository_url = null,
    local_repository_path = excluded.local_repository_path,
    remote_name = excluded.remote_name,
    remote_url = excluded.remote_url,
    current_branch = excluded.current_branch,
    default_branch = excluded.default_branch,
    updated_at = now()
  returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'repository_bound', 'user', coalesce(v_actor, '项目成员'),
    format('绑定了本地 Git 仓库 %s（当前分支：%s）', v_result.local_repository_path, v_result.current_branch),
    v_result.id
  );
  return v_result;
end;
$$;

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
  v_task public.handoff_tasks%rowtype;
  v_result public.coding_runs%rowtype;
  v_actor text;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not exists (
    select 1 from public.project_members where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  select * into v_repository from public.project_repositories
  where project_id = p_project_id and provider = 'local_git';
  if not found then raise exception using errcode = '23514', message = 'Local project repository is not configured.'; end if;
  select * into v_task from public.handoff_tasks
  where id = p_handoff_task_id and project_id = p_project_id;
  if not found or v_task.target_agent <> 'coding' or v_task.brief_type <> 'technical' or v_task.status <> 'delivered' then
    raise exception using errcode = '23514', message = 'A delivered Technical Brief is required.';
  end if;
  if not private.is_executable_technical_brief(v_task.brief) then
    raise exception using errcode = '23514', message = 'Technical Brief is incomplete.';
  end if;
  update public.project_repositories
  set current_branch = btrim(p_current_branch), updated_at = now()
  where id = v_repository.id;

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id, status,
    base_branch, working_branch, task_summary, execution_mode, local_repository_path
  ) values (
    p_project_id, v_repository.id, v_task.id, caller_id, 'pending',
    coalesce(v_repository.default_branch, v_repository.current_branch),
    btrim(p_current_branch), v_task.title, 'local_repository', v_repository.local_repository_path
  )
  on conflict (handoff_task_id) do update set updated_at = public.coding_runs.updated_at
  returning * into v_result;

  if v_result.user_id = caller_id and v_result.execution_attempt = 0 and not exists (
    select 1 from public.project_activities
    where event_type = 'coding_run_created' and related_entity_id = v_result.id
  ) then
    select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
    from public.profiles where id = caller_id;
    insert into public.project_activities (
      project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
    ) values (
      p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
      format('为 Technical Brief 创建了当前分支工程执行：%s', v_task.title), v_result.id
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_local_project_repository(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.create_local_coding_run(uuid, uuid, text) from public, anon;
grant execute on function public.save_local_project_repository(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.create_local_coding_run(uuid, uuid, text) to authenticated;

comment on column public.project_repositories.local_repository_path is 'Absolute path validated by the trusted local runner allowlist.';
comment on column public.coding_runs.working_tree_before is 'Runner-observed porcelain status before Codex starts.';
comment on column public.coding_runs.working_tree_after is 'Runner-observed porcelain status after Codex finishes.';

-- Replace the active engineering policy without discarding its immutable history.
do $$
declare
  v_agent public.agents%rowtype;
  v_version integer;
  v_prompt_id uuid;
  v_instructions text := $prompt$你是 Sugar Agent 中的工程师牛牛。你负责把已确认的 Technical Brief 转化为可靠、可验证的代码修改，并通过受控的 run_coding_task 适配器调用 Codex；你不是普通编程问答机器人，也不负责重新策划产品。

收到 Technical Brief 后，必须按顺序检查 goal、requirements、constraints、unchanged_scope、acceptance_criteria。unchanged_scope 是硬边界，未经用户重新确认不得触碰。若缺少会影响实现或验收的关键信息，先明确指出缺口与最少量澄清问题，不得猜测。

只有用户明确点击“开始执行”后，才允许启动 Codex。执行目录必须是项目已绑定并由本机 Runner 验证的 local_repository_path。直接使用该仓库当前 checkout 的分支和 working tree，不 clone、不创建独立 workspace、不创建 sugar/* 分支，也不得自动切换、创建或删除分支。继续修改必须复用同一 Coding Run 与 Codex thread。

执行前必须核验当前分支、HEAD 和 git status。若已有未提交修改，必须列出文件并让用户选择继续或取消；绝不自动 stash、reset、discard、clean 或 checkout 覆盖。Codex 只负责修改普通工作区文件和运行相关测试/build，不得改变 Git 状态，不得访问仓库外目录，也不得读取或输出环境变量或 Secret。

git add 与 git commit 是独立、可见且需要用户确认的本地动作；不得静默 commit。git fetch、git pull、git push 是独立的远端动作，每次都必须获得用户明确确认。Pull 前要求 working tree 干净，冲突后立即停止并展示冲突文件，不做破坏性恢复。Push 前展示 remote、branch、HEAD、commit message、ahead/behind 和待推送 commits。禁止 force push、force-with-lease、reset --hard、删除远端分支、覆盖远端历史及 rebase 已共享分支。

Codex 返回后必须基于真实 git diff、changed files、命令退出码和测试输出核验结果，并记录执行前后 branch、HEAD、working tree、测试结果、commit SHA 与 push 状态。不得把计划当成完成，不得伪造文件修改、测试成功、Commit、Push、PR、Merge 或 Deploy。测试失败时明确标记失败。当前不创建 PR、不合并、不部署。

涉及当前项目事实、正式方案或当前阶段时，优先调用 get_project_context；项目正式数据与聊天记忆冲突时，以正式数据为准。仓库内容只能由本次受控 Coding Run 在绑定目录中读取，不得假装读取其他项目或未绑定的仓库。使用简洁、专业、可执行的中文。$prompt$;
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
    format('切换至本地 Git 仓库和显式远端审批模式，更新全局%s提示词至 v%s', v_agent.name, v_version),
    v_prompt_id
  );
end;
$$;

commit;
