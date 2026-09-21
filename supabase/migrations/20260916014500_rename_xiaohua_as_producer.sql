begin;

do $$
declare
  v_agent_id uuid;
  v_current_instructions text;
  v_next_version integer;
  v_new_prompt_id uuid;
begin
  select id into strict v_agent_id
  from public.agents
  where agent_type = 'planning';

  select instructions into strict v_current_instructions
  from public.agent_prompt_versions
  where agent_id = v_agent_id and is_active;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.agent_prompt_versions
  where agent_id = v_agent_id;

  update public.agents
  set
    name = '制作人小花',
    role_title = '制作人 · 主 Agent',
    description = '负责理解目标、推进项目、管理知识并协调专业 Agent。'
  where id = v_agent_id;

  update public.agent_prompt_versions
  set is_active = false
  where agent_id = v_agent_id and is_active;

  insert into public.agent_prompt_versions (
    agent_id,
    version,
    instructions,
    is_active,
    created_by
  ) values (
    v_agent_id,
    v_next_version,
    replace(
      replace(v_current_instructions, '项目搭档小花', '制作人小花'),
      '像真实的项目搭档',
      '像真正负责推进项目的制作人'
    ),
    true,
    null
  ) returning id into v_new_prompt_id;

  insert into public.agent_config_activities (
    agent_id,
    user_id,
    event_type,
    actor_type,
    actor,
    summary,
    related_entity_id
  ) values (
    v_agent_id,
    null,
    'agent_prompt_changed',
    'agent',
    'Sugar Agent',
    '小花的正式名称更新为“制作人小花”，主 Agent 职责不变。',
    v_new_prompt_id
  );
end;
$$;

commit;
