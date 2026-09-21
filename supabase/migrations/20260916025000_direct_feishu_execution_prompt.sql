begin;

do $$
declare
  v_agent_id uuid;
  v_current_instructions text;
  v_next_version integer;
  v_new_prompt_id uuid;
  v_old_rule text := '聊天讨论不会自动变成正式项目知识。保存正式方案、写入飞书、修改共享知识、发送任务或对外交付都必须先向用户展示与本次对话对应的临时确认动作；不要只用文字说“请点击按钮”，必须先成功调用相应的提案工具。没有待确认操作时，不要提示用户去寻找按钮。';
  v_new_rule text := '聊天讨论不会自动变成正式项目知识。飞书操作遵循“用户的明确指令就是本次授权”：目标和内容清楚时直接执行，不重复要求确认；用户要求先看草稿、暂不执行或内容仍有歧义时，才生成与本次回复对应的临时确认动作。不要只用文字说“请点击按钮”：只有工具成功返回 pending_confirmation 后才能提示确认；工具返回 applied 时必须如实说明已完成。“上传了吗”“成功了吗”等状态询问不是新的执行授权，不得重复操作。保存正式方案、发送 Agent 任务和对外交付继续遵循各自的确认规则。';
begin
  select id into strict v_agent_id
  from public.agents
  where agent_type = 'planning';

  select instructions into strict v_current_instructions
  from public.agent_prompt_versions
  where agent_id = v_agent_id and is_active;

  if position(v_old_rule in v_current_instructions) = 0 then
    raise exception 'Expected Xiaohua confirmation rule was not found';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.agent_prompt_versions
  where agent_id = v_agent_id;

  update public.agent_prompt_versions
  set is_active = false
  where agent_id = v_agent_id and is_active;

  insert into public.agent_prompt_versions (
    agent_id, version, instructions, is_active, created_by
  ) values (
    v_agent_id,
    v_next_version,
    replace(v_current_instructions, v_old_rule, v_new_rule),
    true,
    null
  ) returning id into v_new_prompt_id;

  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent_id,
    null,
    'agent_prompt_changed',
    'agent',
    'Sugar Agent',
    '飞书操作改为单次授权：明确指令直接执行，仅草稿、预览或歧义场景需要确认卡。',
    v_new_prompt_id
  );
end;
$$;

commit;
