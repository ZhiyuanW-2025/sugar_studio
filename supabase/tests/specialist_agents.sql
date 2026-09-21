-- Run with: npx supabase db query --linked --file supabase/tests/specialist_agents.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('77000000-0000-4000-8000-000000000001', 'agents-a@sugar.invalid', '{}', now(), now()),
  ('77000000-0000-4000-8000-000000000002', 'agents-b@sugar.invalid', '{}', now(), now());
insert into public.projects (id, name)
values
  ('77000000-0000-4000-8000-000000000101', 'Agents Project A'),
  ('77000000-0000-4000-8000-000000000102', 'Agents Project B');
insert into public.project_members (project_id, user_id, role)
values
  ('77000000-0000-4000-8000-000000000101', '77000000-0000-4000-8000-000000000001', 'member'),
  ('77000000-0000-4000-8000-000000000102', '77000000-0000-4000-8000-000000000001', 'member'),
  ('77000000-0000-4000-8000-000000000101', '77000000-0000-4000-8000-000000000002', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);

insert into public.agent_threads (id, user_id, project_id, agent_type, title)
values
  ('77000000-0000-4000-8000-000000000201', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000101', 'planning', '策划师小花'),
  ('77000000-0000-4000-8000-000000000202', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000101', 'coding', '工程师牛牛'),
  ('77000000-0000-4000-8000-000000000203', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000101', 'design', '艺术家小熊'),
  ('77000000-0000-4000-8000-000000000204', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000102', 'coding', '工程师牛牛'),
  ('77000000-0000-4000-8000-000000000205', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000101', 'client', '客户伙伴小雪');

select public.append_agent_turn(
  '77000000-0000-4000-8000-000000000202',
  '77000000-0000-4000-8000-000000000301',
  '牛牛第一轮',
  '牛牛第一轮回复'
);
select public.append_agent_turn(
  '77000000-0000-4000-8000-000000000203',
  '77000000-0000-4000-8000-000000000302',
  '小熊第一轮',
  '小熊第一轮回复'
);
select public.append_agent_turn(
  '77000000-0000-4000-8000-000000000205',
  '77000000-0000-4000-8000-000000000305',
  '小雪第一轮',
  '小雪第一轮回复'
);

do $$
begin
  if (select count(*) from public.messages where thread_id = '77000000-0000-4000-8000-000000000202') <> 2 then
    raise exception 'coding session did not persist independently';
  end if;
  if (select count(*) from public.messages where thread_id = '77000000-0000-4000-8000-000000000203') <> 2 then
    raise exception 'design session did not persist independently';
  end if;
  if (select count(*) from public.messages where thread_id = '77000000-0000-4000-8000-000000000205') <> 2 then
    raise exception 'client-delivery session did not persist independently';
  end if;
  if exists (select 1 from public.messages where thread_id in ('77000000-0000-4000-8000-000000000201', '77000000-0000-4000-8000-000000000204')) then
    raise exception 'messages leaked across agent type or project';
  end if;
  if exists (
    select 1 from public.agents as agent
    where agent.agent_type in ('coding', 'design', 'client')
      and not exists (
        select 1 from public.agent_prompt_versions as prompt
        where prompt.agent_id = agent.id and prompt.is_active
      )
  ) then
    raise exception 'specialist Agent lacks active prompt';
  end if;
  if (select count(*) from public.agents) <> 4 then
    raise exception 'projects created duplicate Agent definitions';
  end if;
  if not exists (
    select 1 from public.agent_prompt_versions as prompt
    join public.agents as agent on agent.id = prompt.agent_id
    where agent.agent_type = 'coding' and prompt.is_active and prompt.version >= 2
      and prompt.instructions like '%unchanged_scope 是硬边界%'
      and prompt.instructions like '%真正的代码理解、技术讨论和工程执行由 Codex 直接完成%'
  ) then
    raise exception 'Niuniu professional global prompt is not active';
  end if;
  if not exists (
    select 1 from public.agent_prompt_versions as prompt
    join public.agents as agent on agent.id = prompt.agent_id
    where agent.agent_type = 'design' and prompt.is_active and prompt.version >= 2
      and prompt.instructions like '%size_or_medium%'
      and prompt.instructions like '%图片工作区明确确认%'
      and prompt.instructions like '%必须保持不变%'
  ) then
    raise exception 'Xiaoxiong professional global prompt is not active';
  end if;
  if not exists (
    select 1 from public.agent_prompt_versions as prompt
    join public.agents as agent on agent.id = prompt.agent_id
    where agent.agent_type = 'client'
      and prompt.is_active
      and prompt.instructions like '%所有输出默认都是内部草稿%'
      and prompt.instructions like '%不能自行修改项目策划、价格、范围、交期%'
  ) then
    raise exception 'Xiaoxue client-delivery global prompt is not active';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (
    select 1 from public.agent_threads
    where user_id = '77000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'user B can read user A specialist threads';
  end if;
  if exists (select 1 from public.messages) then
    raise exception 'user B can read user A specialist messages';
  end if;
end;
$$;

select 'four Agent types, prompt availability, project separation, and user session isolation passed' as result;

rollback;
