-- Run with: npx supabase db query --linked --file supabase/tests/auth_membership_rls.sql
-- Every fixture and write is rolled back at the end of the transaction.

begin;

create function private.assert_count(
  check_name text,
  actual_count bigint,
  expected_count bigint
)
returns void
language plpgsql
as $$
begin
  if actual_count <> expected_count then
    raise exception '%: expected %, got %', check_name, expected_count, actual_count;
  end if;
end;
$$;

grant execute on function private.assert_count(text, bigint, bigint) to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'rls-a@sugar.invalid',
    '{"display_name":"RLS User A"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'rls-b@sugar.invalid',
    '{"display_name":"RLS User B"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'rls-c@sugar.invalid',
    '{"display_name":"RLS User C"}'::jsonb,
    now(),
    now()
  );

insert into public.projects (id, name, description, status)
values (
  '20000000-0000-4000-8000-000000000001',
  'RLS Test Project',
  'Temporary transaction-scoped fixture',
  'testing'
);

insert into public.project_members (id, project_id, user_id, role)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'project_lead'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'member'
  );

insert into public.project_snapshots (id, project_id, summary, current_plan_summary, current_stage)
values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'RLS test',
  'RLS test plan',
  'testing'
);

insert into public.agent_threads (id, project_id, user_id, agent_type, title)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'planning',
    'User A planning thread'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'planning',
    'User B planning thread'
  );

insert into public.messages (id, thread_id, request_id, role, content)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'user',
    'Private message for user A'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',
    'user',
    'Private message for user B'
  );

-- Anonymous clients have no table privileges, before RLS is even considered.
select private.assert_count(
  'anonymous cannot select projects',
  has_table_privilege('anon', 'public.projects', 'select')::int,
  0
);

-- User C is authenticated but is not a project member.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select private.assert_count(
  'non-member cannot read project',
  (select count(*) from public.projects where id = '20000000-0000-4000-8000-000000000001'),
  0
);
select private.assert_count(
  'non-member cannot read snapshot',
  (select count(*) from public.project_snapshots where project_id = '20000000-0000-4000-8000-000000000001'),
  0
);
select private.assert_count(
  'non-member cannot read threads',
  (select count(*) from public.agent_threads where project_id = '20000000-0000-4000-8000-000000000001'),
  0
);
reset role;

-- User A is project_lead. The role label must not grant extra access.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select private.assert_count(
  'project_lead can read project',
  (select count(*) from public.projects where id = '20000000-0000-4000-8000-000000000001'),
  1
);
select private.assert_count(
  'project_lead can read member list',
  (select count(*) from public.project_members where project_id = '20000000-0000-4000-8000-000000000001'),
  2
);
select private.assert_count(
  'project_lead sees only own thread',
  (select count(*) from public.agent_threads where project_id = '20000000-0000-4000-8000-000000000001'),
  1
);
select private.assert_count(
  'project_lead cannot read member thread',
  (select count(*) from public.agent_threads where id = '50000000-0000-4000-8000-000000000002'),
  0
);
select private.assert_count(
  'project_lead cannot read member message',
  (select count(*) from public.messages where id = '60000000-0000-4000-8000-000000000002'),
  0
);
select private.assert_count(
  'project_lead can read collaborator profiles',
  (select count(*) from public.profiles where id in (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'
  )),
  2
);
with changed as (
  update public.projects
  set status = 'lead_updated'
  where id = '20000000-0000-4000-8000-000000000001'
  returning 1
)
select private.assert_count('project_lead can update project', count(*), 1)
from changed;
with changed as (
  update public.profiles
  set display_name = 'RLS User A Updated'
  where id = '10000000-0000-4000-8000-000000000001'
  returning 1
)
select private.assert_count('user can update own profile', count(*), 1)
from changed;
with changed as (
  update public.profiles
  set display_name = 'Forbidden Update'
  where id = '10000000-0000-4000-8000-000000000002'
  returning 1
)
select private.assert_count('user cannot update collaborator profile', count(*), 0)
from changed;
with changed as (
  insert into public.project_members (project_id, user_id, role)
  values (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'member'
  )
  returning 1
)
select private.assert_count('project member can add member', count(*), 1)
from changed;
with changed as (
  update public.project_members
  set role = 'project_lead'
  where project_id = '20000000-0000-4000-8000-000000000001'
    and user_id = '10000000-0000-4000-8000-000000000003'
  returning 1
)
select private.assert_count('project member can update member', count(*), 1)
from changed;
with changed as (
  delete from public.project_members
  where project_id = '20000000-0000-4000-8000-000000000001'
    and user_id = '10000000-0000-4000-8000-000000000003'
  returning 1
)
select private.assert_count('project member can delete member', count(*), 1)
from changed;
reset role;

-- User B is a regular member and receives the same project-level access.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select private.assert_count(
  'member can read project',
  (select count(*) from public.projects where id = '20000000-0000-4000-8000-000000000001'),
  1
);
select private.assert_count(
  'member can read member list',
  (select count(*) from public.project_members where project_id = '20000000-0000-4000-8000-000000000001'),
  2
);
with changed as (
  update public.projects
  set status = 'member_updated'
  where id = '20000000-0000-4000-8000-000000000001'
  returning 1
)
select private.assert_count('member can update project', count(*), 1)
from changed;
select private.assert_count(
  'member sees only own thread',
  (select count(*) from public.agent_threads where project_id = '20000000-0000-4000-8000-000000000001'),
  1
);
select private.assert_count(
  'member cannot read lead thread',
  (select count(*) from public.agent_threads where id = '50000000-0000-4000-8000-000000000001'),
  0
);
select private.assert_count(
  'member cannot read lead message',
  (select count(*) from public.messages where id = '60000000-0000-4000-8000-000000000001'),
  0
);
with changed as (
  update public.messages
  set content = 'Updated by user B'
  where id = '60000000-0000-4000-8000-000000000002'
  returning 1
)
select private.assert_count('member can update own message', count(*), 1)
from changed;
with changed as (
  update public.messages
  set content = 'Forbidden Update'
  where id = '60000000-0000-4000-8000-000000000001'
  returning 1
)
select private.assert_count('member cannot update lead message', count(*), 0)
from changed;
reset role;

select 'all auth and membership RLS assertions passed' as result;

rollback;
