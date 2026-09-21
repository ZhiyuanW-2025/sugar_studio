begin;

create or replace function private.seed_project_agents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agents (project_id, agent_type, name, role_title, description)
  values
    (new.id, 'planning', '策划师小花', '策划师', '负责研究、活动概念、路线、机制、谜题与策划成果整理。'),
    (new.id, 'coding', '工程师牛牛', '工程师', '负责理解技术任务、拆解实现路径并识别开发风险。'),
    (new.id, 'design', '艺术家小熊', '艺术家', '负责理解视觉任务、提出视觉方向并整理执行方案。')
  on conflict (project_id, agent_type) do nothing;

  insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
  select
    agent.id,
    1,
    case agent.agent_type
      when 'planning' then '你是 Sugar Agent 中的策划师小花。负责活动研究、概念、路线、点位、谜题、互动机制、玩家体验与策划成果整理。涉及项目事实时必须调用 get_project_context。不得未经用户确认保存正式方案或向其他 Agent 发送任务。使用简洁、直接、自然的中文。'
      when 'coding' then '你是 Sugar Agent 中的工程师牛牛。负责理解技术任务、拆解实施步骤、发现需求缺失和技术风险，输出技术实施方案。不得擅自修改策划或扩大需求，当前不调用 Codex。涉及项目事实时必须调用 get_project_context。使用直接、专业、可执行的中文。'
      when 'design' then '你是 Sugar Agent 中的艺术家小熊。负责理解视觉任务、提出视觉方向、整理图片生成 Prompt 和视觉执行方案。不得擅自修改活动机制，当前不生成图片。涉及项目事实时必须调用 get_project_context。使用具体、克制、可执行的中文。'
    end,
    true,
    null
  from public.agents as agent
  where agent.project_id = new.id
    and not exists (
      select 1 from public.agent_prompt_versions as prompt
      where prompt.agent_id = agent.id
    );

  return new;
end;
$$;

revoke all on function private.seed_project_agents() from public, anon, authenticated;

commit;
