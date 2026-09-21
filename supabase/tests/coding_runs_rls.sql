-- Run with: npx supabase db query --linked --file supabase/tests/coding_runs_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('78000000-0000-4000-8000-000000000001', 'coding-a@sugar.invalid', '{}', now(), now()),
  ('78000000-0000-4000-8000-000000000002', 'coding-b@sugar.invalid', '{}', now(), now()),
  ('78000000-0000-4000-8000-000000000003', 'coding-outsider@sugar.invalid', '{}', now(), now());
insert into public.projects (id, name) values
  ('78000000-0000-4000-8000-000000000101', 'Coding Project'),
  ('78000000-0000-4000-8000-000000000102', 'No Repository Project');
insert into public.project_members (project_id, user_id, role) values
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'project_lead'),
  ('78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000002', 'member'),
  ('78000000-0000-4000-8000-000000000102', '78000000-0000-4000-8000-000000000001', 'project_lead');
insert into public.agent_threads (id, project_id, user_id, agent_type, title) values
  ('78000000-0000-4000-8000-000000000201', '78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'planning', '策划师小花'),
  ('78000000-0000-4000-8000-000000000202', '78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000001', 'coding', '工程师牛牛'),
  ('78000000-0000-4000-8000-000000000203', '78000000-0000-4000-8000-000000000102', '78000000-0000-4000-8000-000000000001', 'planning', '策划师小花'),
  ('78000000-0000-4000-8000-000000000204', '78000000-0000-4000-8000-000000000102', '78000000-0000-4000-8000-000000000001', 'coding', '工程师牛牛');

insert into public.handoff_tasks (
  id, project_id, source_agent, target_agent, source_thread_id, target_thread_id,
  title, content, brief_type, brief, status, created_by, approved_at, delivered_at
) values
  (
    '78000000-0000-4000-8000-000000000301', '78000000-0000-4000-8000-000000000101', 'planning', 'coding',
    '78000000-0000-4000-8000-000000000201', '78000000-0000-4000-8000-000000000202', 'Safe coding task', 'Technical Brief', 'technical',
    '{"title":"Safe coding task","goal":"Implement one change","background":"Test","requirements":["Change one file"],"constraints":["No deploy"],"unchanged_scope":["Other files"],"acceptance_criteria":["Test passes"],"related_project":"Coding Project","source_plan_version":null}',
    'delivered', '78000000-0000-4000-8000-000000000001', now(), now()
  ),
  (
    '78000000-0000-4000-8000-000000000302', '78000000-0000-4000-8000-000000000102', 'planning', 'coding',
    '78000000-0000-4000-8000-000000000203', '78000000-0000-4000-8000-000000000204', 'No repo task', 'Technical Brief', 'technical',
    '{"title":"No repo task","goal":"Implement one change","background":"Test","requirements":["Change one file"],"constraints":[],"unchanged_scope":[],"acceptance_criteria":["Test passes"],"related_project":"No Repository Project","source_plan_version":null}',
    'delivered', '78000000-0000-4000-8000-000000000001', now(), now()
  ),
  (
    '78000000-0000-4000-8000-000000000303', '78000000-0000-4000-8000-000000000101', 'planning', 'coding',
    '78000000-0000-4000-8000-000000000201', '78000000-0000-4000-8000-000000000202', 'Incomplete task', 'Technical Brief', 'technical',
    '{"title":"Incomplete task","goal":"Unknown change","background":"Test","requirements":[],"constraints":[],"unchanged_scope":[],"acceptance_criteria":[],"related_project":"Coding Project","source_plan_version":null}',
    'delivered', '78000000-0000-4000-8000-000000000001', now(), now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000001', true);

select public.save_local_project_repository(
  '78000000-0000-4000-8000-000000000101', '/tmp/sugar-coding-project', 'origin',
  'ssh://git@git.studio.invalid/coding-project.git', 'main', 'main'
);
select public.create_local_coding_run(
  '78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000301',
  'main'
);

do $$
begin
  if (select count(*) from public.project_repositories) <> 1 then raise exception 'repository binding failed'; end if;
  if (select count(*) from public.coding_runs) <> 1 then raise exception 'coding run creation failed'; end if;
  if not exists (
    select 1 from public.agent_prompt_versions p join public.agents a on a.id = p.agent_id
    where a.agent_type = 'coding' and p.is_active and p.instructions like '%run_coding_task%'
      and p.instructions like '%local_repository_path%'
      and p.instructions like '%不得静默 commit%'
  ) then raise exception 'global Niuniu execution prompt is not active'; end if;

  begin
    update public.coding_runs set status = 'merged';
    raise exception 'client forged coding result status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_coding_run(
      '78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000301', 'legacy'
    );
    raise exception 'legacy create_coding_run RPC was accepted';
  exception when undefined_function then null;
  end;
  begin
    perform public.create_local_coding_run(
      '78000000-0000-4000-8000-000000000102', '78000000-0000-4000-8000-000000000302',
      'main'
    );
    raise exception 'run without repository was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_local_coding_run(
      '78000000-0000-4000-8000-000000000101', '78000000-0000-4000-8000-000000000303',
      'main'
    );
    raise exception 'incomplete Technical Brief was accepted';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.project_repositories) <> 1 then raise exception 'same-project member cannot read repository'; end if;
  if (select count(*) from public.coding_runs) <> 1 then raise exception 'same-project member cannot read coding run'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000003', true);
do $$
begin
  if exists (select 1 from public.project_repositories) then raise exception 'outsider can read repository'; end if;
  if exists (select 1 from public.coding_runs) then raise exception 'outsider can read coding runs'; end if;
  begin
    perform public.save_local_project_repository(
      '78000000-0000-4000-8000-000000000101', '/tmp/forbidden', 'origin',
      'ssh://git@git.studio.invalid/forbidden.git', 'main', 'main'
    );
    raise exception 'outsider changed repository';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'repository membership, local coding-run isolation, legacy RPC removal, no-repository guard, direct-write protection, and global Niuniu prompt passed' as result;
rollback;
