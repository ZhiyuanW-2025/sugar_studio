begin;

-- Create new immutable Skill versions that explicitly include the Agent-only
-- general knowledge retrieval tool.
insert into public.agent_skill_versions (
  skill_id, version, name, description, trigger_description, negative_triggers,
  instructions, output_requirements, allowed_tools, reference_material,
  test_cases, is_active, created_by
)
select
  skill.id,
  current_version.version + 1,
  current_version.name,
  current_version.description,
  current_version.trigger_description,
  current_version.negative_triggers,
  current_version.instructions || case skill.slug
    when 'xhs-content-planning' then E'\n9. 在形成选题和内容矩阵前，必须调用 search_agent_general_knowledge 检索与本次任务相关的小红书选题、内容策略与基础方法；不得只依赖模型常识。'
    when 'xhs-post-creation' then E'\n9. 在写作或修改具体作品前，必须调用 search_agent_general_knowledge 检索与本轮相关的标题钩子、写作风格、选题方法或内容 Playbook；检索结果与当前人工修改冲突时，保留人工修改。'
    else E'\n7. 在整理给小熊的指令前，必须调用 search_agent_general_knowledge 检索与本图相关的视觉叙事方法；项目事实和当前图片建议仍优先。'
  end,
  current_version.output_requirements,
  case
    when 'search_agent_general_knowledge' = any(current_version.allowed_tools) then current_version.allowed_tools
    else array_append(current_version.allowed_tools, 'search_agent_general_knowledge')
  end,
  current_version.reference_material,
  current_version.test_cases,
  false,
  null
from public.agent_skills as skill
join public.agents as agent on agent.id = skill.agent_id and agent.agent_type = 'marketing'
join public.agent_skill_versions as current_version
  on current_version.skill_id = skill.id and current_version.is_active
where skill.slug in ('xhs-content-planning', 'xhs-post-creation', 'xhs-image-prompt');

update public.agent_skill_versions as version
set is_active = false
where version.skill_id in (
  select skill.id
  from public.agent_skills as skill
  join public.agents as agent on agent.id = skill.agent_id and agent.agent_type = 'marketing'
  where skill.slug in ('xhs-content-planning', 'xhs-post-creation', 'xhs-image-prompt')
);

update public.agent_skill_versions as version
set is_active = true
where version.id in (
  select distinct on (candidate.skill_id) candidate.id
  from public.agent_skill_versions as candidate
  join public.agent_skills as skill on skill.id = candidate.skill_id
  join public.agents as agent on agent.id = skill.agent_id and agent.agent_type = 'marketing'
  where skill.slug in ('xhs-content-planning', 'xhs-post-creation', 'xhs-image-prompt')
  order by candidate.skill_id, candidate.version desc
);

-- Preserve the existing global prompt as a new version and add the missing
-- retrieval requirement instead of mutating prompt history.
insert into public.agent_prompt_versions (
  agent_id, version, instructions, is_active, created_by
)
select
  prompt.agent_id,
  prompt.version + 1,
  prompt.instructions || E'\n\n豆豆的飞书 Agent 通用知识库与项目材料是两套独立知识源。只要任务涉及小红书选题、标题、钩子、写作风格、内容结构或视觉叙事，你必须先加载匹配的 Skill，再调用 search_agent_general_knowledge 做针对性检索；不得声称已经参考某份通用知识却没有调用该工具。涉及当前活动事实时另行使用 get_project_context 或 search_project_knowledge。两类检索不能互相替代。',
  false,
  null
from public.agent_prompt_versions as prompt
join public.agents as agent on agent.id = prompt.agent_id and agent.agent_type = 'marketing'
where prompt.is_active;

update public.agent_prompt_versions
set is_active = false
where agent_id = (select id from public.agents where agent_type = 'marketing');

update public.agent_prompt_versions as prompt
set is_active = true
where prompt.id = (
  select candidate.id
  from public.agent_prompt_versions as candidate
  join public.agents as agent on agent.id = candidate.agent_id and agent.agent_type = 'marketing'
  order by candidate.version desc
  limit 1
);

commit;
