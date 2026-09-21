begin;

create function public.update_project_brain_context(
  p_project_id uuid,
  p_summary text,
  p_current_stage text
)
returns public.project_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  result public.project_snapshots%rowtype;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if length(btrim(coalesce(p_summary, ''))) > 12000
     or length(btrim(coalesce(p_current_stage, ''))) > 200 then
    raise exception using errcode = '23514', message = 'Project context is too long.';
  end if;

  insert into public.project_snapshots (project_id, summary, current_stage)
  values (p_project_id, btrim(coalesce(p_summary, '')), btrim(coalesce(p_current_stage, '')))
  on conflict (project_id) do update set
    summary = excluded.summary,
    current_stage = excluded.current_stage,
    updated_at = now()
  returning * into result;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id,
    caller_id,
    'project_context_updated',
    'user',
    coalesce(actor_name, '项目成员'),
    '更新了项目大脑中的正式概况与阶段',
    result.id
  );

  return result;
end;
$$;

create function public.rollback_current_plan(
  p_project_id uuid,
  p_target_version_id uuid
)
returns table (
  artifact_id uuid,
  version_id uuid,
  version integer,
  current_plan_summary text,
  change_summary text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.artifact_versions%rowtype;
  plan_artifact public.artifacts%rowtype;
  next_version integer;
  new_version_id uuid;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select artifact.* into plan_artifact
  from public.artifacts as artifact
  where artifact.project_id = p_project_id
    and artifact.artifact_type = 'planning_plan'
  for update;
  if plan_artifact.id is null then
    raise exception using errcode = 'P0002', message = 'Planning artifact not found.';
  end if;

  select version_row.* into target
  from public.artifact_versions as version_row
  where version_row.id = p_target_version_id
    and version_row.artifact_id = plan_artifact.id;
  if target.id is null then
    raise exception using errcode = 'P0002', message = 'Target version not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':planning_plan', 0));
  select coalesce(max(existing.version), 0) + 1 into next_version
  from public.artifact_versions as existing
  where existing.artifact_id = plan_artifact.id;

  insert into public.artifact_versions (
    artifact_id, version, content, change_summary, created_by, source_thread_id
  ) values (
    plan_artifact.id,
    next_version,
    target.content,
    format('回滚至 v%s：%s', target.version, target.change_summary),
    caller_id,
    target.source_thread_id
  ) returning id into new_version_id;

  update public.artifacts set current_version_id = new_version_id, updated_at = now()
  where id = plan_artifact.id;
  update public.project_snapshots
  set current_plan_summary = target.content,
      current_plan_version_id = new_version_id,
      updated_at = now()
  where project_id = p_project_id;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id,
    caller_id,
    'plan_version_rolled_back',
    'user',
    coalesce(actor_name, '项目成员'),
    format('将正式策划方案回滚至 v%s，并创建 v%s', target.version, next_version),
    new_version_id
  );

  return query select
    plan_artifact.id,
    new_version_id,
    next_version,
    target.content,
    format('回滚至 v%s：%s', target.version, target.change_summary);
end;
$$;

revoke all on function public.update_project_brain_context(uuid, text, text) from public, anon;
revoke all on function public.rollback_current_plan(uuid, uuid) from public, anon;
grant execute on function public.update_project_brain_context(uuid, text, text) to authenticated;
grant execute on function public.rollback_current_plan(uuid, uuid) to authenticated;

comment on function public.rollback_current_plan(uuid, uuid) is 'Creates a new immutable planning version from a selected historical version and makes it current.';

commit;
