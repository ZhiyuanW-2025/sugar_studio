begin;

delete from public.agent_skills
where agent_id = (select id from public.agents where agent_type = 'marketing')
  and slug in ('plan-activity-campaign','create-activity-marketing-content','direct-activity-visuals','review-activity-promotion');

insert into public.agent_skills(agent_id, slug, status, created_by)
select agent.id, seed.slug, 'active', null
from public.agents agent
cross join (values ('xhs-content-planning'),('xhs-post-creation'),('xhs-image-prompt')) seed(slug)
where agent.agent_type = 'marketing'
on conflict (agent_id, slug) do update set status = 'active', updated_at = now();

insert into public.agent_skill_versions(skill_id,version,name,description,trigger_description,negative_triggers,instructions,output_requirements,allowed_tools,reference_material,test_cases,is_active,created_by)
select skill.id, coalesce((select max(v.version)+1 from public.agent_skill_versions v where v.skill_id=skill.id),1), seed.name, seed.description, seed.trigger, seed.negative, seed.instructions, seed.output, seed.tools, seed.reference, seed.tests, true, null
from public.agent_skills skill
join public.agents agent on agent.id=skill.agent_id and agent.agent_type='marketing'
join (values
('xhs-content-planning','xhs_content_planning','规划当前项目适合发布的小红书选题、内容矩阵与阶段内容日历。','用户询问当前项目能发什么、要求多个选题、一周至一个月计划、内容矩阵或活动阶段宣传规划时使用。可在没有当前宣传作品时运行。','不用于撰写或修改某一篇完整作品；不自动批量创建草稿；不为追热点虚构项目事实。',
E'1. 明确宣传目标、周期、受众或场景；只追问会显著改变规划的缺口。\n2. 调用 get_project_context 和 search_project_knowledge 理解真实项目内容、素材概况与可公开事实；需要时加载豆豆的通用小红书知识。\n3. 从用户需求出发生成真正不同的传播角度，可使用搜索型、推荐型、攻略型、场景型、信息差、体验、幕后等方向，但不要机械凑类型。\n4. 批量规划必须做角度去重，并设计内容顺序、建议时间与篇目关系。\n5. 每项说明选题、受众/场景、用户需求、角度、内容承诺、支撑事实和形式。\n6. 不自动创建 marketing_contents；先把规划交给用户选择。不得虚构卖点、评价、现场或效果。',
E'按用户请求返回单篇或 planning_items 列表。每项至少包含：核心选题、受众或场景、用户需求、角度、内容承诺、项目事实依据、内容形式与备注。批量规划补充顺序、建议时间和篇目关系。输出自然、可读，不展示内部 JSON 字段。',array['get_project_context','search_project_knowledge']::text[],
E'规划是项目级工作，不依赖 active marketing_content_id。项目事实与材料优先于平台套路；没有依据的信息标记待确认。',
'{"should_trigger":["这个项目能发什么小红书？","未来两周给我规划十篇不同角度。","这个活动预热阶段能发哪些内容？"],"should_not_trigger":["把当前这篇第二段改自然一点。","把这条图片建议改成给小熊的生图指令。"]}'::jsonb),
('xhs-post-creation','xhs_post_creation','创建、重写、局部修改或补全一篇具体的小红书宣传作品，并同步更新右侧草稿。','用户要求写具体小红书、采用某个选题成稿、修改当前作品、补全文案或为当前作品形成图片建议时使用。通常需要当前 active marketing_content_id。','不用于项目级内容日历；不直接生图或发布；没有当前作品时不得假装已写回草稿。',
E'1. 判断本轮是 create、replace、patch、append 还是 keep。\n2. 有当前宣传作品时，以服务端提供的最新作品状态为准；用户在右侧手动编辑的内容优先于聊天历史。\n3. 调用 get_project_context、search_project_knowledge，并按需加载 Fundamentals、Topic Strategy、Title & Hook、Writing Style、Visual Storytelling 和 Content Playbook。\n4. 明确选题、用户需求、账号叙事视角和内容目标，完成所需的标题、正文、标签与补充说明。\n5. 同时形成数量合理的图片建议，每项包含 order、role、purpose、suggestion，并可补充 on_image_text、composition_notes。只规划每张图承担什么作用，不判断由谁上传、从哪里找或是否 AI 生成。\n6. 局部请求只 patch 对应字段，不重写未被要求的标题、正文或图片建议；整体重写才 replace。\n7. 调用 update_marketing_content 把变更写回当前作品。没有 active marketing_content_id 时，先给出草稿并说明需要用户创建或选中作品后才能写回。\n8. 聊天回复只给人类可读的变更摘要，不重复输出完整数据库对象。',
E'写回后简要说明修改范围和图片建议数量。例如：正文改为玩家视角，并补充 5 条图片建议。不要输出内部字段、工具参数或完整对象。',array['get_project_context','search_project_knowledge','update_marketing_content']::text[],
E'更新模式：create=创建内容；replace=整体替换指定字段；patch=仅修改相关字段；append=追加；keep=保持。图片建议不是强状态机，用户可以不采用或上传其他图片。',
'{"should_trigger":["就用刚刚第三个选题写一篇完整小红书。","当前这篇第二段太官方，改自然一点。","给这篇补一套图片建议。"],"should_not_trigger":["这个项目未来一个月应该发什么？","只把某条图片建议转换成给小熊的 Prompt。"]}'::jsonb),
('xhs-image-prompt','xhs_image_prompt','把当前作品中的一条图片建议转换为可由用户编辑、复制给小熊的高质量图片或设计指令。','用户点击某条图片建议旁的“去 AI 生成”，或明确要求把某条配图建议整理成给小熊的指令时使用。','不自动调用小熊、不自动生图、不自动发送 Prompt、不修改当前作品。',
E'1. 读取当前项目与当前作品最新状态，理解所选图片在整篇作品中的用途。\n2. 结合被点击的图片建议、项目真实事实、可用视觉材料概况和用户补充要求。\n3. 生成一段完整自然语言指令，写清用途、平台位置、核心表达、主体、场景、构图、必需元素、禁止元素、图中文字、风格气质、比例和项目视觉一致性。\n4. 概念视觉不得伪装为真实现场；不得发明不存在的 Logo、人物、地点、装置或活动事实。\n5. 信息图、路线图、封面排版应写成设计任务，不要统一写成文生图提示词。\n6. 只返回给用户复制编辑的指令；绝不调用小熊、生成图片或发送任务。',
E'只输出一段可直接复制给小熊的自然语言完整指令，不展示 JSON、工具参数、解释性前言或“已发送”字样。',array['get_project_context','search_project_knowledge']::text[],
E'该 Skill 的终点是可编辑 Prompt。后续是否修改、复制或交给小熊完全由用户决定。',
'{"should_trigger":["把 P1 封面建议转换成给小熊的指令。","点击去 AI 生成：使用光影场景和任务卡做封面。"],"should_not_trigger":["直接替我生成图片。","把整篇小红书正文重写。"]}'::jsonb)
) seed(slug,name,description,trigger,negative,instructions,output,tools,reference,tests) on seed.slug=skill.slug
where not exists (select 1 from public.agent_skill_versions v where v.skill_id=skill.id and v.is_active);

commit;
