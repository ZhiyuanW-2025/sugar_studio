begin;

alter table public.user_project_repository_workspaces
  add column if not exists runner_device_id uuid
  references public.runner_devices (id) on delete set null;

create index if not exists user_project_repository_workspaces_device_idx
  on public.user_project_repository_workspaces (runner_device_id)
  where runner_device_id is not null;

update public.user_project_repository_workspaces workspace
set runner_device_id = (
  select runner.id
  from public.runner_devices runner
  where runner.user_id = workspace.user_id
    and runner.status = 'active'
  order by runner.last_seen_at desc nulls last, runner.paired_at desc
  limit 1
)
where workspace.runner_device_id is null
  and exists (
    select 1 from public.runner_devices runner
    where runner.user_id = workspace.user_id and runner.status = 'active'
  );

drop function if exists public.save_user_project_repository_workspace(uuid, text, text, text, text, text);

create function public.save_user_project_repository_workspace(
  p_project_id uuid,
  p_runner_device_id uuid,
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
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_runner_device_id is not null and not exists (
    select 1 from public.runner_devices
    where id = p_runner_device_id and user_id = caller_id and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Runner device access denied.';
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
    provider = 'local_git',
    remote_url = excluded.remote_url,
    default_branch = excluded.default_branch,
    updated_at = now()
  returning * into v_result;

  insert into public.user_project_repository_workspaces (
    project_id, user_id, runner_device_id, local_repository_path, remote_name, current_branch
  ) values (
    p_project_id, caller_id, p_runner_device_id, btrim(p_local_repository_path),
    btrim(p_remote_name), btrim(p_current_branch)
  )
  on conflict (project_id, user_id) do update set
    runner_device_id = excluded.runner_device_id,
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
    format('更新了代码仓库配置（远程：%s，本地工作目录仅本人可见）',
      coalesce(nullif(btrim(p_remote_url), ''), '未配置')),
    v_result.id
  );
  return v_result;
end;
$$;

revoke all on function public.save_user_project_repository_workspace(uuid, uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.save_user_project_repository_workspace(uuid, uuid, text, text, text, text, text)
  to authenticated;

comment on column public.user_project_repository_workspaces.runner_device_id is
  'The user-owned Sugar Runner device that validates and executes against this exact local repository path.';

commit;
