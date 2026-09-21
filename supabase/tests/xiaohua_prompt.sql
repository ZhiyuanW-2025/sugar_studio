-- Run with: npx supabase db query --linked --file supabase/tests/xiaohua_prompt.sql
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.agents as agent
  where agent.agent_type = 'planning'
    and not exists (
      select 1 from public.agent_prompt_versions as prompt
      where prompt.agent_id = agent.id
        and prompt.is_active
        and prompt.instructions like '%策划师小花%'
        and prompt.instructions like '%get_project_context%'
        and prompt.instructions like '%未经用户确认%'
        and prompt.instructions like '%工程师牛牛%'
        and prompt.instructions like '%艺术家小熊%'
    );

  if v_missing <> 0 then
    raise exception 'one or more planning agents lack the first active Xiaohua prompt';
  end if;

  if (select count(*) from public.agents where agent_type = 'planning') <> 1 then
    raise exception 'Xiaohua is not a single global Agent';
  end if;

  if exists (
    select 1 from public.agents as agent
    where agent.agent_type = 'planning'
      and (select count(*) from public.agent_prompt_versions as prompt where prompt.agent_id = agent.id and prompt.is_active) <> 1
  ) then
    raise exception 'a planning agent does not have exactly one active prompt';
  end if;
end;
$$;

select 'Xiaohua is global and has one preserved active responsibility prompt' as result;
