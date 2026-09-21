-- Run with: npx supabase db query --linked --file supabase/tests/plan_versions_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('73000000-0000-4000-8000-000000000001', 'plan-a@sugar.invalid', '{"display_name":"Plan A"}', now(), now()),
  ('73000000-0000-4000-8000-000000000002', 'plan-b@sugar.invalid', '{"display_name":"Plan B"}', now(), now());

insert into public.projects (id, name)
values
  ('73000000-0000-4000-8000-000000000101', 'Plan Version Project'),
  ('73000000-0000-4000-8000-000000000102', 'Other Project');

insert into public.project_members (project_id, user_id, role)
values
  ('73000000-0000-4000-8000-000000000101', '73000000-0000-4000-8000-000000000001', 'member'),
  ('73000000-0000-4000-8000-000000000102', '73000000-0000-4000-8000-000000000001', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);

insert into public.agent_threads (id, user_id, project_id, agent_type, title)
values
  ('73000000-0000-4000-8000-000000000201', '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000101', 'planning', 'Plan Source'),
  ('73000000-0000-4000-8000-000000000202', '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000102', 'planning', 'Other Source');

select * from public.save_current_plan(
  '73000000-0000-4000-8000-000000000101',
  '73000000-0000-4000-8000-000000000201',
  '正式方案第一版',
  '首次保存'
);

select * from public.save_current_plan(
  '73000000-0000-4000-8000-000000000101',
  '73000000-0000-4000-8000-000000000201',
  '正式方案第二版',
  '调整任务节奏'
);

do $$
declare
  v_artifact_id uuid;
  v_current_version_id uuid;
begin
  select id, current_version_id
  into v_artifact_id, v_current_version_id
  from public.artifacts
  where project_id = '73000000-0000-4000-8000-000000000101'
    and artifact_type = 'planning_plan';

  if (select count(*) from public.artifact_versions where artifact_id = v_artifact_id) <> 2 then
    raise exception 'each confirmed save must create a new version';
  end if;

  if not exists (
    select 1 from public.artifact_versions
    where artifact_id = v_artifact_id and version = 1 and content = '正式方案第一版'
  ) then
    raise exception 'old plan version was not retained';
  end if;

  if not exists (
    select 1 from public.artifact_versions
    where id = v_current_version_id and version = 2 and content = '正式方案第二版'
  ) then
    raise exception 'artifact current version did not advance';
  end if;

  if not exists (
    select 1 from public.project_snapshots
    where project_id = '73000000-0000-4000-8000-000000000101'
      and current_plan_version_id = v_current_version_id
      and current_plan_summary = '正式方案第二版'
  ) then
    raise exception 'project snapshot did not point to the latest plan';
  end if;

  if (select count(*) from public.project_activities where project_id = '73000000-0000-4000-8000-000000000101') <> 2 then
    raise exception 'plan saves did not record activity';
  end if;

  if exists (
    select 1 from public.artifact_versions
    where artifact_id = v_artifact_id
      and (created_by is null or source_thread_id is null)
  ) then
    raise exception 'plan version provenance is incomplete';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.save_current_plan(
      '73000000-0000-4000-8000-000000000101',
      '73000000-0000-4000-8000-000000000202',
      '越权来源',
      '不应成功'
    );
    raise exception 'cross-project source thread was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (select 1 from public.artifacts) then
    raise exception 'non-member can read artifacts';
  end if;
  if exists (select 1 from public.artifact_versions) then
    raise exception 'non-member can read artifact versions';
  end if;
  if exists (select 1 from public.project_activities) then
    raise exception 'non-member can read activities';
  end if;

  begin
    perform public.save_current_plan(
      '73000000-0000-4000-8000-000000000101',
      '73000000-0000-4000-8000-000000000201',
      '非成员方案',
      '不应成功'
    );
    raise exception 'non-member save was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select 'plan versioning, snapshot update, provenance, activity, and RLS assertions passed' as result;

rollback;
