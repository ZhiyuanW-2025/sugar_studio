-- Run with: npx supabase db query --linked --file supabase/tests/activity_log_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('78000000-0000-4000-8000-000000000001', 'activity-a@sugar.invalid', '{}', now(), now()),
  ('78000000-0000-4000-8000-000000000002', 'activity-b@sugar.invalid', '{}', now(), now());
insert into public.projects (id, name)
values ('78000000-0000-4000-8000-000000000101', 'Activity Project');
insert into public.project_members (project_id, user_id, role)
values ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'member');

insert into public.project_activities (
  project_id, user_id, event_type, actor_type, actor, summary
) values
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'plan_version_saved', 'user', 'Activity A', '保存正式方案'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'project_file_uploaded', 'user', 'Activity A', '上传文件'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'project_file_deleted', 'user', 'Activity A', '删除文件'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'handoff_task_created', 'agent', '策划师小花', '创建交接草稿'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'handoff_task_approved', 'user', 'Activity A', '批准交接任务'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'handoff_task_delivered', 'user', 'Activity A', '发送交接任务');

set local role authenticated;
select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000001', true);
do $$ begin
  if (select count(*) from public.project_activities) <> 6 then
    raise exception 'project member cannot read complete activity timeline';
  end if;
  if (select count(distinct event_type) from public.project_activities) <> 6 then
    raise exception 'expected activity event types are incomplete';
  end if;
  begin
    insert into public.project_activities (project_id, event_type, actor_type, actor, summary)
    values ('78000000-0000-4000-8000-000000000101', 'bypass', 'user', 'A', 'bypass');
    raise exception 'direct activity insertion was unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000002', true);
do $$ begin
  if exists (select 1 from public.project_activities) then
    raise exception 'non-member can read activity timeline';
  end if;
end $$;

select 'activity event coverage, direct-write protection, and member RLS passed' as result;
rollback;
