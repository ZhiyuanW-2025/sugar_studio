-- Run with: npx supabase db query --linked --file supabase/tests/handoff_tasks_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('76000000-0000-4000-8000-000000000001', 'handoff-a@sugar.invalid', '{"display_name":"Handoff A"}', now(), now()),
  ('76000000-0000-4000-8000-000000000002', 'handoff-b@sugar.invalid', '{"display_name":"Handoff B"}', now(), now());

insert into public.projects (id, name)
values ('76000000-0000-4000-8000-000000000101', 'Handoff Project');
insert into public.project_members (project_id, user_id, role)
values ('76000000-0000-4000-8000-000000000101', '76000000-0000-4000-8000-000000000001', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000001', true);

insert into public.agent_threads (id, project_id, user_id, agent_type, title)
values (
  '76000000-0000-4000-8000-000000000201',
  '76000000-0000-4000-8000-000000000101',
  '76000000-0000-4000-8000-000000000001',
  'planning',
  '策划师小花'
);

select public.create_handoff_draft(
  '76000000-0000-4000-8000-000000000101',
  '76000000-0000-4000-8000-000000000201',
  'coding',
  null,
  jsonb_build_object(
    'title', 'Moon Moi 技术任务',
    'goal', '调整任务流程',
    'background', '玩家停留时间过长',
    'requirements', jsonb_build_array('改为单步视觉匹配'),
    'constraints', jsonb_build_array('三分钟内完成'),
    'unchanged_scope', jsonb_build_array('其他页面不得修改'),
    'acceptance_criteria', jsonb_build_array('任务可在三分钟内完成'),
    'related_project', '客户端值会被服务端覆盖',
    'source_plan_version', null
  )
);

do $$
declare
  v_task public.handoff_tasks%rowtype;
begin
  select * into v_task from public.handoff_tasks
  where project_id = '76000000-0000-4000-8000-000000000101';
  if v_task.status <> 'draft' or v_task.approved_at is not null or v_task.delivered_at is not null
     or v_task.brief_type <> 'technical'
     or v_task.brief->>'related_project' <> 'Handoff Project'
     or v_task.brief->'unchanged_scope' <> '["其他页面不得修改"]'::jsonb then
    raise exception 'new handoff was not retained as an unapproved draft';
  end if;
  if exists (
    select 1 from public.agent_threads
    where project_id = v_task.project_id and user_id = v_task.created_by and agent_type = 'coding'
  ) then
    raise exception 'draft was delivered before user confirmation';
  end if;
  begin
    update public.handoff_tasks set status = 'delivered' where id = v_task.id;
    raise exception 'direct handoff update was unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config(
  'test.handoff_id',
  (select id::text from public.handoff_tasks where project_id = '76000000-0000-4000-8000-000000000101'),
  true
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000002', true);

do $$
declare
  v_task_id uuid := current_setting('test.handoff_id')::uuid;
begin
  if exists (select 1 from public.handoff_tasks) then
    raise exception 'non-member can read handoff tasks';
  end if;
  begin
    perform public.approve_and_deliver_handoff(
      '76000000-0000-4000-8000-000000000101', v_task_id,
      jsonb_build_object('title', 'Forbidden')
    );
    raise exception 'non-member delivery was unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_task_id uuid;
begin
  select id into v_task_id from public.handoff_tasks
  where project_id = '76000000-0000-4000-8000-000000000101';
  perform public.approve_and_deliver_handoff(
    '76000000-0000-4000-8000-000000000101',
    v_task_id,
    jsonb_build_object(
      'title', 'Moon Moi 技术任务（已编辑）',
      'goal', '调整任务流程',
      'background', '玩家停留时间过长',
      'requirements', jsonb_build_array('改为单步视觉匹配'),
      'constraints', jsonb_build_array('三分钟内完成'),
      'unchanged_scope', jsonb_build_array('其他页面不得修改'),
      'acceptance_criteria', jsonb_build_array('三分钟内完成且其他页面无变化'),
      'related_project', '不可伪造的项目',
      'source_plan_version', '不可伪造的版本'
    )
  );

  if not exists (
    select 1 from public.handoff_tasks
    where id = v_task_id and status = 'delivered'
      and approved_at is not null and delivered_at is not null and target_thread_id is not null
      and title = 'Moon Moi 技术任务（已编辑）'
  ) then
    raise exception 'confirmed handoff was not approved and delivered';
  end if;
  if not exists (
    select 1 from public.messages as message
    join public.agent_threads as thread on thread.id = message.thread_id
    where message.request_id = v_task_id and message.role = 'system'
      and message.content like '%三分钟内完成%'
      and message.content like '%unchanged_scope%'
      and message.content like '%其他页面不得修改%'
      and thread.user_id = '76000000-0000-4000-8000-000000000001'
      and thread.project_id = '76000000-0000-4000-8000-000000000101'
      and thread.agent_type = 'coding'
  ) then
    raise exception 'target user thread did not receive the approved task';
  end if;
  if (select count(*) from public.project_activities where related_entity_id = v_task_id) <> 3 then
    raise exception 'handoff create, approve, and deliver activities are incomplete';
  end if;

  begin
    perform public.approve_and_deliver_handoff(
      '76000000-0000-4000-8000-000000000101', v_task_id,
      jsonb_build_object('title', 'Duplicate')
    );
    raise exception 'duplicate delivery was unexpectedly allowed';
  exception when check_violation then
    null;
  end;
end;
$$;

select 'handoff draft, explicit approval, delivery, idempotency protection, activity, and RLS assertions passed' as result;

rollback;
