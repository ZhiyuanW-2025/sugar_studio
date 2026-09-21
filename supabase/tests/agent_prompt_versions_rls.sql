-- Run with: npx supabase db query --linked --file supabase/tests/agent_prompt_versions_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('75000000-0000-4000-8000-000000000001', 'prompt-a@sugar.invalid', '{"display_name":"Prompt A"}', now(), now()),
  ('75000000-0000-4000-8000-000000000002', 'prompt-b@sugar.invalid', '{"display_name":"Prompt B"}', now(), now());

insert into public.projects (id, name)
values
  ('75000000-0000-4000-8000-000000000101', 'Prompt Project One'),
  ('75000000-0000-4000-8000-000000000102', 'Prompt Project Two');
insert into public.project_members (project_id, user_id, role)
values
  ('75000000-0000-4000-8000-000000000101', '75000000-0000-4000-8000-000000000001', 'member'),
  ('75000000-0000-4000-8000-000000000102', '75000000-0000-4000-8000-000000000001', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000001', true);
select set_config(
  'test.prompt_base_version',
  (select max(prompt.version)::text from public.agent_prompt_versions as prompt
   join public.agents as agent on agent.id = prompt.agent_id
   where agent.agent_type = 'planning'),
  true
);

select public.save_agent_prompt('planning', 'Global prompt version one');
select public.save_agent_prompt('planning', 'Global prompt version two');

do $$
declare
  v_agent_id uuid;
  v_base integer := current_setting('test.prompt_base_version')::integer;
begin
  select id into v_agent_id from public.agents where agent_type = 'planning';
  if (select count(*) from public.agents where agent_type = 'planning') <> 1 then
    raise exception 'planning Agent is not globally unique';
  end if;
  if (select count(*) from public.agent_prompt_versions where agent_id = v_agent_id and is_active) <> 1 then
    raise exception 'global Agent does not have exactly one active prompt';
  end if;
  if not exists (
    select 1 from public.agent_prompt_versions
    where agent_id = v_agent_id
      and version = v_base + 2
      and is_active
      and instructions = 'Global prompt version two'
      and created_by = '75000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'latest global prompt was not activated with provenance';
  end if;
  -- Both projects resolve through the same global agent_type and active row;
  -- there is no project_id column on either global configuration table.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('agents', 'agent_prompt_versions')
      and column_name = 'project_id'
  ) then
    raise exception 'global Agent configuration still contains project_id';
  end if;
  if (select count(*) from public.agents) <> 4 then
    raise exception 'workspace must contain exactly four global Agents';
  end if;
  if (
    select count(distinct active_prompt.id)
    from (
      values
        ('75000000-0000-4000-8000-000000000101'::uuid),
        ('75000000-0000-4000-8000-000000000102'::uuid)
    ) as project_scope(project_id)
    cross join public.agents as global_agent
    join public.agent_prompt_versions as active_prompt
      on active_prompt.agent_id = global_agent.id and active_prompt.is_active
    where global_agent.agent_type = 'planning'
  ) <> 1 then
    raise exception 'two projects did not resolve to the same global planning prompt';
  end if;
  if exists (
    select 1 from public.project_activities
    where event_type in ('agent_prompt_changed', 'agent_prompt_rolled_back')
  ) then
    raise exception 'global prompt activity leaked into project activity';
  end if;
  begin
    insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
    values (v_agent_id, v_base + 99, 'direct bypass', false, '75000000-0000-4000-8000-000000000001');
    raise exception 'direct prompt insert was unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select public.rollback_agent_prompt(
  'planning', current_setting('test.prompt_base_version')::integer + 1
);

do $$
declare
  v_agent_id uuid;
  v_base integer := current_setting('test.prompt_base_version')::integer;
begin
  select id into v_agent_id from public.agents where agent_type = 'planning';
  if not exists (
    select 1 from public.agent_prompt_versions
    where agent_id = v_agent_id
      and version = v_base + 3
      and is_active
      and instructions = 'Global prompt version one'
  ) then
    raise exception 'global rollback did not create an active copy as a new version';
  end if;
  if (
    select count(*) from public.agent_config_activities
    where agent_id = v_agent_id
      and user_id = '75000000-0000-4000-8000-000000000001'
      and event_type = 'agent_prompt_changed'
  ) <> 2 then
    raise exception 'global prompt change activities missing';
  end if;
  if (
    select count(*) from public.agent_config_activities
    where agent_id = v_agent_id
      and user_id = '75000000-0000-4000-8000-000000000001'
      and event_type = 'agent_prompt_rolled_back'
  ) <> 1 then
    raise exception 'global prompt rollback activity missing';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (select 1 from public.agents) then
    raise exception 'non-workspace user can read global Agents';
  end if;
  if exists (select 1 from public.agent_prompt_versions) then
    raise exception 'non-workspace user can read global prompt versions';
  end if;
  if exists (select 1 from public.agent_config_activities) then
    raise exception 'non-workspace user can read global Agent activities';
  end if;
  begin
    perform public.save_agent_prompt('planning', 'Forbidden prompt');
    raise exception 'non-workspace prompt save was unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'global Agent uniqueness, prompt versioning, rollback, Activity scope, direct-write protection, and RLS passed' as result;
rollback;
