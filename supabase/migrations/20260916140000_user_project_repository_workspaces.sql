begin;

-- Remote repository metadata belongs to the project. A local checkout belongs
-- to one signed-in member and must not be exposed to the rest of the project.
create table public.user_project_repository_workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  local_repository_path text not null check (
    length(btrim(local_repository_path)) between 2 and 2048
    and left(btrim(local_repository_path), 1) = '/'
  ),
  remote_name text not null default 'origin' check (remote_name ~ '^[A-Za-z0-9._-]+$'),
  current_branch text not null check (
    length(btrim(current_branch)) between 1 and 255
    and current_branch !~ '(^|/)\.\.(/|$)'
    and current_branch !~ '[~^:?*]'
    and current_branch not like '%[%'
    and current_branch not like '%\\%'
    and current_branch !~ '[[:space:]]'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index user_project_repository_workspaces_user_idx
  on public.user_project_repository_workspaces (user_id, project_id);

create trigger user_project_repository_workspaces_set_updated_at
before update on public.user_project_repository_workspaces
for each row execute function public.set_sugar_agent_updated_at();

alter table public.user_project_repository_workspaces enable row level security;
revoke all on table public.user_project_repository_workspaces from public, anon, authenticated;
grant select, insert, update, delete on table public.user_project_repository_workspaces to authenticated;

create policy user_project_repository_workspaces_select_own
on public.user_project_repository_workspaces for select to authenticated
using (user_id = (select auth.uid()) and private.is_project_member(project_id));
create policy user_project_repository_workspaces_insert_own
on public.user_project_repository_workspaces for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_project_member(project_id));
create policy user_project_repository_workspaces_update_own
on public.user_project_repository_workspaces for update to authenticated
using (user_id = (select auth.uid()) and private.is_project_member(project_id))
with check (user_id = (select auth.uid()) and private.is_project_member(project_id));
create policy user_project_repository_workspaces_delete_own
on public.user_project_repository_workspaces for delete to authenticated
using (user_id = (select auth.uid()) and private.is_project_member(project_id));

-- Preserve the existing creator's local checkout before removing the path
-- from the project-scoped row.
insert into public.user_project_repository_workspaces (
  project_id, user_id, local_repository_path, remote_name, current_branch
)
select project_id, created_by, local_repository_path, remote_name, current_branch
from public.project_repositories
where created_by is not null
  and local_repository_path is not null
  and current_branch is not null
on conflict (project_id, user_id) do nothing;

alter table public.project_repositories drop constraint if exists project_repositories_local_path_check;
update public.project_repositories set local_repository_path = null, current_branch = null;

drop function if exists public.save_local_project_repository(uuid, text, text, text, text, text);

create function public.save_user_project_repository_workspace(
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
  if not exists (select 1 from public.project_members where project_id = p_project_id and user_id = caller_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  insert into public.project_repositories (
    project_id, provider, repository_owner, repository_name, repository_url,
    local_repository_path, remote_name, remote_url, current_branch,
    default_branch, created_by
  ) values (
    p_project_id, 'local_git', null, null, null, null, 'origin',
    nullif(btrim(p_remote_url), ''), null, nullif(btrim(p_default_branch), ''), caller_id
  )
  on conflict (project_id) do update set
    provider = 'local_git', remote_url = excluded.remote_url,
    default_branch = excluded.default_branch, updated_at = now()
  returning * into v_result;

  insert into public.user_project_repository_workspaces (
    project_id, user_id, local_repository_path, remote_name, current_branch
  ) values (
    p_project_id, caller_id, btrim(p_local_repository_path), btrim(p_remote_name), btrim(p_current_branch)
  )
  on conflict (project_id, user_id) do update set
    local_repository_path = excluded.local_repository_path,
    remote_name = excluded.remote_name,
    current_branch = excluded.current_branch,
    updated_at = now();

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'repository_bound', 'user', coalesce(v_actor, '项目成员'),
    format('更新了代码仓库配置（远程：%s，本地工作目录仅本人可见）', coalesce(nullif(btrim(p_remote_url), ''), '未配置')),
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
  v_workspace public.user_project_repository_workspaces%rowtype;
  v_task public.handoff_tasks%rowtype;
  v_result public.coding_runs%rowtype;
  v_actor text;
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
  if not found or v_task.target_agent <> 'coding' or v_task.brief_type <> 'technical' or v_task.status <> 'delivered' then
    raise exception using errcode = '23514', message = 'A delivered Technical Brief is required.';
  end if;
  if not private.is_executable_technical_brief(v_task.brief) then
    raise exception using errcode = '23514', message = 'Technical Brief is incomplete.';
  end if;
  update public.user_project_repository_workspaces
  set current_branch = btrim(p_current_branch), updated_at = now()
  where id = v_workspace.id;

  insert into public.coding_runs (
    project_id, repository_id, handoff_task_id, user_id, status,
    base_branch, working_branch, task_summary, execution_mode, local_repository_path
  ) values (
    p_project_id, v_repository.id, v_task.id, caller_id, 'pending',
    coalesce(v_repository.default_branch, v_workspace.current_branch),
    btrim(p_current_branch), v_task.title, 'local_repository', v_workspace.local_repository_path
  )
  on conflict (handoff_task_id) do update set updated_at = public.coding_runs.updated_at
  returning * into v_result;

  if v_result.user_id = caller_id and v_result.execution_attempt = 0 and not exists (
    select 1 from public.project_activities where event_type = 'coding_run_created' and related_entity_id = v_result.id
  ) then
    select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor from public.profiles where id = caller_id;
    insert into public.project_activities (project_id, user_id, event_type, actor_type, actor, summary, related_entity_id)
    values (p_project_id, caller_id, 'coding_run_created', 'user', coalesce(v_actor, '项目成员'),
      format('为 Technical Brief 创建了当前分支工程执行：%s', v_task.title), v_result.id);
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_user_project_repository_workspace(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.save_user_project_repository_workspace(uuid, text, text, text, text, text) to authenticated;

comment on table public.user_project_repository_workspaces is 'Private per-user local checkout used by 牛牛; project members cannot read one another local paths.';
comment on column public.project_repositories.remote_url is 'Project-shared remote Git address.';

commit;
