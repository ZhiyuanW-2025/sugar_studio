begin;

alter table public.projects
  add column if not exists archived_at timestamptz;

create index if not exists projects_member_list_idx
  on public.projects (status, updated_at desc, id);

create function public.create_sugar_project(
  p_name text,
  p_description text default ''
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  created_project public.projects%rowtype;
  actor_name text;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Project name is required';
  end if;

  insert into public.projects (name, description, status)
  values (left(btrim(p_name), 120), left(btrim(coalesce(p_description, '')), 2000), 'active')
  returning * into created_project;

  insert into public.project_members (project_id, user_id, role)
  values (created_project.id, caller_id, 'project_lead');

  insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage)
  values (created_project.id, '', '', '筹备中')
  on conflict (project_id) do nothing;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    created_project.id,
    caller_id,
    'project_created',
    'user',
    coalesce(actor_name, '项目成员'),
    '创建了项目「' || created_project.name || '」',
    created_project.id
  );

  return created_project;
end;
$$;

create function public.add_project_member_by_email(
  p_project_id uuid,
  p_email text,
  p_role text default 'member'
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_user_id uuid;
  created_membership public.project_members%rowtype;
  actor_name text;
  target_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception 'Project membership required';
  end if;
  if p_role not in ('project_lead', 'member') then
    raise exception 'Invalid project role';
  end if;
  if length(btrim(coalesce(p_email, ''))) = 0 then
    raise exception 'Email is required';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;

  if target_user_id is null then
    raise exception 'User not found';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, target_user_id, p_role)
  returning * into created_membership;

  select display_name into actor_name from public.profiles where id = caller_id;
  select display_name into target_name from public.profiles where id = target_user_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id,
    caller_id,
    'project_member_added',
    'user',
    coalesce(actor_name, '项目成员'),
    '添加了项目成员「' || coalesce(target_name, btrim(p_email)) || '」',
    created_membership.id
  );

  return created_membership;
exception
  when unique_violation then
    raise exception 'User is already a project member';
end;
$$;

create function public.update_project_member_role(
  p_project_id uuid,
  p_membership_id uuid,
  p_role text
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.project_members%rowtype;
  updated_membership public.project_members%rowtype;
  lead_count integer;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception 'Project membership required';
  end if;
  if p_role not in ('project_lead', 'member') then
    raise exception 'Invalid project role';
  end if;

  select * into target
  from public.project_members
  where id = p_membership_id and project_id = p_project_id
  for update;
  if target.id is null then
    raise exception 'Membership not found';
  end if;

  if target.role = 'project_lead' and p_role = 'member' then
    select count(*) into lead_count
    from public.project_members
    where project_id = p_project_id and role = 'project_lead';
    if lead_count <= 1 then
      raise exception 'Project must keep at least one lead';
    end if;
  end if;

  update public.project_members
  set role = p_role
  where id = p_membership_id
  returning * into updated_membership;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id,
    caller_id,
    'project_member_role_updated',
    'user',
    coalesce(actor_name, '项目成员'),
    '更新了项目成员身份',
    p_membership_id
  );

  return updated_membership;
end;
$$;

create function public.remove_project_member(
  p_project_id uuid,
  p_membership_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.project_members%rowtype;
  member_count integer;
  lead_count integer;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception 'Project membership required';
  end if;

  select * into target
  from public.project_members
  where id = p_membership_id and project_id = p_project_id
  for update;
  if target.id is null then
    raise exception 'Membership not found';
  end if;

  select count(*) into member_count from public.project_members where project_id = p_project_id;
  if member_count <= 1 then
    raise exception 'Project must keep at least one member';
  end if;

  if target.role = 'project_lead' then
    select count(*) into lead_count
    from public.project_members
    where project_id = p_project_id and role = 'project_lead';
    if lead_count <= 1 then
      raise exception 'Project must keep at least one lead';
    end if;
  end if;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id,
    caller_id,
    'project_member_removed',
    'user',
    coalesce(actor_name, '项目成员'),
    '移除了一位项目成员',
    p_membership_id
  );

  delete from public.project_members where id = p_membership_id;
  return true;
end;
$$;

revoke all on function public.create_sugar_project(text, text) from public, anon;
revoke all on function public.add_project_member_by_email(uuid, text, text) from public, anon;
revoke all on function public.update_project_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_project_member(uuid, uuid) from public, anon;

grant execute on function public.create_sugar_project(text, text) to authenticated;
grant execute on function public.add_project_member_by_email(uuid, text, text) to authenticated;
grant execute on function public.update_project_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated;

comment on column public.projects.archived_at is 'Set when a project is archived; archived projects remain readable to members.';
comment on function public.create_sugar_project(text, text) is 'Atomically creates a project, its initial snapshot, and the creator membership.';

commit;
