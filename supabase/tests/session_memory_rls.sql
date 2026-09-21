-- Run with: npx supabase db query --linked --file supabase/tests/session_memory_rls.sql
-- Fixtures, messages, threads, model configs, and Vault secrets roll back.

begin;

create function private.assert_count(check_name text, actual_count bigint, expected_count bigint)
returns void
language plpgsql
as $$
begin
  if actual_count <> expected_count then
    raise exception '%: expected %, got %', check_name, expected_count, actual_count;
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('72000000-0000-4000-8000-000000000001', 'session-a@sugar.invalid', '{}', now(), now()),
  ('72000000-0000-4000-8000-000000000002', 'session-b@sugar.invalid', '{}', now(), now());

insert into public.projects (id, name)
values
  ('72000000-0000-4000-8000-000000000101', 'Session Project One'),
  ('72000000-0000-4000-8000-000000000102', 'Session Project Two');

insert into public.project_members (project_id, user_id, role)
values
  ('72000000-0000-4000-8000-000000000101', '72000000-0000-4000-8000-000000000001', 'member'),
  ('72000000-0000-4000-8000-000000000102', '72000000-0000-4000-8000-000000000001', 'member'),
  ('72000000-0000-4000-8000-000000000101', '72000000-0000-4000-8000-000000000002', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);

insert into public.agent_threads (id, user_id, project_id, agent_type, title)
values
  ('72000000-0000-4000-8000-000000000201', '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000101', 'planning', 'Planning P1'),
  ('72000000-0000-4000-8000-000000000202', '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000101', 'coding', 'Coding P1'),
  ('72000000-0000-4000-8000-000000000203', '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000102', 'planning', 'Planning P2');

do $$
begin
  begin
    insert into public.agent_threads (user_id, project_id, agent_type, title)
    values ('72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000101', 'planning', 'Duplicate');
    raise exception 'duplicate current thread was unexpectedly accepted';
  exception when unique_violation then
    null;
  end;
end;
$$;

select public.append_agent_turn(
  '72000000-0000-4000-8000-000000000201',
  '72000000-0000-4000-8000-000000000301',
  'Moon Moi 任务太复杂了。',
  '可以简化为单步视觉匹配。'
);

select public.append_agent_turn(
  '72000000-0000-4000-8000-000000000201',
  '72000000-0000-4000-8000-000000000302',
  '把刚才的方案控制在三分钟以内。',
  '好的，将刚才的单步视觉匹配控制在三分钟以内。'
);

select private.assert_count(
  'two completed turns produce four messages',
  (select count(*) from public.messages where thread_id = '72000000-0000-4000-8000-000000000201'),
  4
);

-- A repeated network request returns the existing turn and writes nothing.
select public.append_agent_turn(
  '72000000-0000-4000-8000-000000000201',
  '72000000-0000-4000-8000-000000000302',
  'this retry body is ignored',
  'this retry response is ignored'
);

select private.assert_count(
  'repeated request id is idempotent',
  (select count(*) from public.messages where thread_id = '72000000-0000-4000-8000-000000000201'),
  4
);

-- An invalid/incomplete turn rolls back without leaving a lone user message.
do $$
begin
  begin
    perform public.append_agent_turn(
      '72000000-0000-4000-8000-000000000201',
      '72000000-0000-4000-8000-000000000303',
      'This user message must not remain.',
      ''
    );
    raise exception 'incomplete turn was unexpectedly accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

select private.assert_count(
  'failed turn leaves no partial message',
  (select count(*) from public.messages where request_id = '72000000-0000-4000-8000-000000000303'),
  0
);

select private.assert_count(
  'project two planning thread is isolated',
  (select count(*) from public.messages where thread_id = '72000000-0000-4000-8000-000000000203'),
  0
);

select private.assert_count(
  'coding thread is isolated from planning',
  (select count(*) from public.messages where thread_id = '72000000-0000-4000-8000-000000000202'),
  0
);

reset role;
set local role service_role;

select public.create_user_model_config(
  '72000000-0000-4000-8000-000000000001',
  'openai',
  'session-model-one',
  'sk-session-test-one-ABCD',
  true
);
select public.create_user_model_config(
  '72000000-0000-4000-8000-000000000001',
  'openai',
  'session-model-two',
  'sk-session-test-two-WXYZ',
  false
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);

insert into public.agent_model_preferences (user_id, agent_type, model_config_id)
select '72000000-0000-4000-8000-000000000001', 'planning', id
from public.user_model_configs
where user_id = '72000000-0000-4000-8000-000000000001'
  and model = 'session-model-two';

select private.assert_count(
  'switching planning model preserves database history',
  (select count(*) from public.messages where thread_id = '72000000-0000-4000-8000-000000000201'),
  4
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);

select private.assert_count(
  'user B cannot see user A threads',
  (select count(*) from public.agent_threads where user_id = '72000000-0000-4000-8000-000000000001'),
  0
);

select private.assert_count(
  'user B cannot see user A messages',
  (select count(*) from public.messages),
  0
);

do $$
begin
  begin
    perform public.append_agent_turn(
      '72000000-0000-4000-8000-000000000201',
      '72000000-0000-4000-8000-000000000304',
      'Unauthorized user message',
      'Unauthorized assistant message'
    );
    raise exception 'cross-user append was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select 'all session memory, idempotency, isolation, and RLS assertions passed' as result;

rollback;
