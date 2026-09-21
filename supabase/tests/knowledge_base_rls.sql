-- Run with: npx supabase db query --linked --file supabase/tests/knowledge_base_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('7b000000-0000-4000-8000-000000000001', 'knowledge-rls-a@sugar.invalid', '{}', now(), now()),
  ('7b000000-0000-4000-8000-000000000002', 'knowledge-rls-b@sugar.invalid', '{}', now(), now()),
  ('7b000000-0000-4000-8000-000000000003', 'knowledge-rls-c@sugar.invalid', '{}', now(), now());

insert into public.projects (id, name)
values
  ('7b000000-0000-4000-8000-000000000101', 'Knowledge RLS A'),
  ('7b000000-0000-4000-8000-000000000102', 'Knowledge RLS B');

insert into public.project_members (project_id, user_id, role)
values
  ('7b000000-0000-4000-8000-000000000101', '7b000000-0000-4000-8000-000000000001', 'member'),
  ('7b000000-0000-4000-8000-000000000102', '7b000000-0000-4000-8000-000000000002', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '7b000000-0000-4000-8000-000000000001', true);

select public.register_project_file(
  '7b000000-0000-4000-8000-000000000201',
  '7b000000-0000-4000-8000-000000000101',
  'project-a.txt',
  '7b000000-0000-4000-8000-000000000101/7b000000-0000-4000-8000-000000000201/project-a.txt',
  'txt',
  'text/plain',
  100
);

select public.register_company_file(
  '7b000000-0000-4000-8000-000000000301',
  'company.md',
  '7b000000-0000-4000-8000-000000000301/company.md',
  'md',
  'text/markdown',
  100
);

do $$
begin
  if (select count(*) from public.knowledge_documents) <> 2 then
    raise exception 'project member cannot see own project plus company knowledge';
  end if;
  if (select count(*) from public.knowledge_ingestion_jobs) <> 2 then
    raise exception 'project member cannot see allowed ingestion jobs';
  end if;

  begin
    insert into public.knowledge_chunks default values;
    raise exception 'browser role could write knowledge chunks';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.knowledge_documents set status = 'ready';
    raise exception 'browser role could modify knowledge document state';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '7b000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (
    select 1 from public.knowledge_documents
    where project_id = '7b000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'project knowledge leaked to another project member';
  end if;
  if not exists (
    select 1 from public.knowledge_documents
    where scope = 'company'
  ) then
    raise exception 'company knowledge is not shared with workspace members';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '7b000000-0000-4000-8000-000000000003', true);

do $$
begin
  if exists (select 1 from public.company_files) then
    raise exception 'non-workspace user can read company files';
  end if;
  if exists (select 1 from public.knowledge_documents) then
    raise exception 'non-workspace user can read knowledge documents';
  end if;
  if exists (select 1 from public.knowledge_chunks) then
    raise exception 'non-workspace user can read knowledge chunks';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.agents as agent
    join public.agent_prompt_versions as prompt on prompt.agent_id = agent.id
    where prompt.is_active and position('search_project_knowledge' in prompt.instructions) = 0
  ) then
    raise exception 'an active Agent prompt lacks knowledge-search guidance';
  end if;
end;
$$;

select 'project/company knowledge scope, server-only writes, and RLS assertions passed' as result;

rollback;
