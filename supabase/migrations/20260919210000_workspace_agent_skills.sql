begin;

create table public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  slug text not null check (
    length(slug) between 2 and 64
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  status text not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, slug)
);

create table public.agent_skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.agent_skills(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null check (length(btrim(description)) between 1 and 500),
  trigger_description text not null check (length(btrim(trigger_description)) between 1 and 2000),
  negative_triggers text not null default '' check (length(negative_triggers) <= 2000),
  instructions text not null check (length(btrim(instructions)) between 1 and 20000),
  output_requirements text not null default '' check (length(output_requirements) <= 8000),
  allowed_tools text[] not null default '{}',
  reference_material text not null default '' check (length(reference_material) <= 20000),
  test_cases jsonb not null default '{"should_trigger":[],"should_not_trigger":[]}'::jsonb
    check (jsonb_typeof(test_cases) = 'object'),
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create unique index agent_skill_versions_one_active_idx
  on public.agent_skill_versions(skill_id)
  where is_active;
create index agent_skills_agent_status_idx
  on public.agent_skills(agent_id, status, updated_at desc);
create index agent_skill_versions_history_idx
  on public.agent_skill_versions(skill_id, version desc);

create trigger agent_skills_set_updated_at
before update on public.agent_skills
for each row execute function public.set_sugar_agent_updated_at();

alter table public.agent_skills enable row level security;
alter table public.agent_skill_versions enable row level security;

create policy agent_skills_select_workspace_members
on public.agent_skills for select to authenticated
using (private.is_workspace_member());

create policy agent_skill_versions_select_workspace_members
on public.agent_skill_versions for select to authenticated
using (private.is_workspace_member());

revoke all on table public.agent_skills from anon, authenticated;
revoke all on table public.agent_skill_versions from anon, authenticated;
grant select on table public.agent_skills to authenticated;
grant select on table public.agent_skill_versions to authenticated;
grant all on table public.agent_skills to service_role;
grant all on table public.agent_skill_versions to service_role;

alter table public.agent_config_activities
  drop constraint if exists agent_config_activities_event_type_check;

alter table public.agent_config_activities
  add constraint agent_config_activities_event_type_check
  check (event_type in (
    'agent_prompt_changed',
    'agent_prompt_rolled_back',
    'agent_avatar_changed',
    'agent_avatar_reset',
    'agent_skill_created',
    'agent_skill_version_created',
    'agent_skill_status_changed',
    'agent_skill_rolled_back',
    'agent_skill_deleted'
  ));

create function public.create_agent_skill(
  p_agent_type text,
  p_slug text,
  p_name text,
  p_description text,
  p_trigger_description text,
  p_negative_triggers text,
  p_instructions text,
  p_output_requirements text,
  p_allowed_tools text[],
  p_reference_material text,
  p_test_cases jsonb,
  p_status text default 'draft'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_agent public.agents%rowtype;
  v_skill public.agent_skills%rowtype;
  v_version public.agent_skill_versions%rowtype;
  v_actor text;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_status not in ('draft', 'active', 'disabled')
     or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or length(p_slug) not between 2 and 64
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_description), '') is null
     or nullif(btrim(p_trigger_description), '') is null
     or nullif(btrim(p_instructions), '') is null
     or jsonb_typeof(coalesce(p_test_cases, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '23514', message = 'Invalid skill configuration.';
  end if;

  select * into v_agent from public.agents where agent_type = p_agent_type for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;

  insert into public.agent_skills(agent_id, slug, status, created_by)
  values (v_agent.id, p_slug, p_status, caller_id)
  returning * into v_skill;

  insert into public.agent_skill_versions(
    skill_id, version, name, description, trigger_description, negative_triggers,
    instructions, output_requirements, allowed_tools, reference_material,
    test_cases, is_active, created_by
  ) values (
    v_skill.id, 1, btrim(p_name), btrim(p_description), btrim(p_trigger_description),
    coalesce(btrim(p_negative_triggers), ''), btrim(p_instructions),
    coalesce(btrim(p_output_requirements), ''), coalesce(p_allowed_tools, '{}'),
    coalesce(btrim(p_reference_material), ''), coalesce(p_test_cases, '{"should_trigger":[],"should_not_trigger":[]}'::jsonb),
    true, caller_id
  ) returning * into v_version;

  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities(
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_skill_created', 'user', coalesce(v_actor, '工作室成员'),
    format('为%s创建全局 Skill「%s」', v_agent.name, btrim(p_name)), v_skill.id
  );

  return jsonb_build_object('skill_id', v_skill.id, 'version_id', v_version.id, 'version', 1);
end;
$$;

create function public.save_agent_skill_version(
  p_skill_id uuid,
  p_name text,
  p_description text,
  p_trigger_description text,
  p_negative_triggers text,
  p_instructions text,
  p_output_requirements text,
  p_allowed_tools text[],
  p_reference_material text,
  p_test_cases jsonb,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_skill public.agent_skills%rowtype;
  v_agent public.agents%rowtype;
  v_version_number integer;
  v_version public.agent_skill_versions%rowtype;
  v_actor text;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_status not in ('draft', 'active', 'disabled')
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_description), '') is null
     or nullif(btrim(p_trigger_description), '') is null
     or nullif(btrim(p_instructions), '') is null
     or jsonb_typeof(coalesce(p_test_cases, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '23514', message = 'Invalid skill configuration.';
  end if;

  select * into v_skill from public.agent_skills where id = p_skill_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Skill not found.'; end if;
  select * into v_agent from public.agents where id = v_skill.agent_id;
  select coalesce(max(version), 0) + 1 into v_version_number
  from public.agent_skill_versions where skill_id = v_skill.id;

  update public.agent_skill_versions set is_active = false
  where skill_id = v_skill.id and is_active;
  insert into public.agent_skill_versions(
    skill_id, version, name, description, trigger_description, negative_triggers,
    instructions, output_requirements, allowed_tools, reference_material,
    test_cases, is_active, created_by
  ) values (
    v_skill.id, v_version_number, btrim(p_name), btrim(p_description), btrim(p_trigger_description),
    coalesce(btrim(p_negative_triggers), ''), btrim(p_instructions),
    coalesce(btrim(p_output_requirements), ''), coalesce(p_allowed_tools, '{}'),
    coalesce(btrim(p_reference_material), ''), coalesce(p_test_cases, '{"should_trigger":[],"should_not_trigger":[]}'::jsonb),
    true, caller_id
  ) returning * into v_version;
  update public.agent_skills set status = p_status where id = v_skill.id;

  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities(
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_skill_version_created', 'user', coalesce(v_actor, '工作室成员'),
    format('更新了全局 Skill「%s」至 v%s', btrim(p_name), v_version_number), v_version.id
  );
  return jsonb_build_object('skill_id', v_skill.id, 'version_id', v_version.id, 'version', v_version_number);
end;
$$;

create function public.set_agent_skill_status(p_skill_id uuid, p_status text)
returns public.agent_skills
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_skill public.agent_skills%rowtype;
  v_agent public.agents%rowtype;
  v_name text;
  v_actor text;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_status not in ('draft', 'active', 'disabled') then
    raise exception using errcode = '23514', message = 'Invalid skill status.';
  end if;
  select * into v_skill from public.agent_skills where id = p_skill_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Skill not found.'; end if;
  select * into v_agent from public.agents where id = v_skill.agent_id;
  select name into v_name from public.agent_skill_versions where skill_id = v_skill.id and is_active;
  update public.agent_skills set status = p_status where id = v_skill.id returning * into v_skill;
  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities(
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_skill_status_changed', 'user', coalesce(v_actor, '工作室成员'),
    format('将全局 Skill「%s」状态改为 %s', coalesce(v_name, v_skill.slug), p_status), v_skill.id
  );
  return v_skill;
end;
$$;

create function public.rollback_agent_skill(p_skill_id uuid, p_target_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_skill public.agent_skills%rowtype;
  v_agent public.agents%rowtype;
  v_target public.agent_skill_versions%rowtype;
  v_version_number integer;
  v_version public.agent_skill_versions%rowtype;
  v_actor text;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  select * into v_skill from public.agent_skills where id = p_skill_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Skill not found.'; end if;
  select * into v_agent from public.agents where id = v_skill.agent_id;
  select * into v_target from public.agent_skill_versions
  where skill_id = v_skill.id and version = p_target_version;
  if not found then raise exception using errcode = 'P0002', message = 'Skill version not found.'; end if;
  select coalesce(max(version), 0) + 1 into v_version_number
  from public.agent_skill_versions where skill_id = v_skill.id;
  update public.agent_skill_versions set is_active = false where skill_id = v_skill.id and is_active;
  insert into public.agent_skill_versions(
    skill_id, version, name, description, trigger_description, negative_triggers,
    instructions, output_requirements, allowed_tools, reference_material,
    test_cases, is_active, created_by
  ) values (
    v_skill.id, v_version_number, v_target.name, v_target.description,
    v_target.trigger_description, v_target.negative_triggers, v_target.instructions,
    v_target.output_requirements, v_target.allowed_tools, v_target.reference_material,
    v_target.test_cases, true, caller_id
  ) returning * into v_version;
  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities(
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_skill_rolled_back', 'user', coalesce(v_actor, '工作室成员'),
    format('将全局 Skill「%s」回滚到 v%s，并创建 v%s', v_target.name, p_target_version, v_version_number), v_version.id
  );
  return jsonb_build_object('skill_id', v_skill.id, 'version_id', v_version.id, 'version', v_version_number);
end;
$$;

create function public.delete_draft_agent_skill(p_skill_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_skill public.agent_skills%rowtype;
  v_agent public.agents%rowtype;
  v_name text;
  v_actor text;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  select * into v_skill from public.agent_skills where id = p_skill_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Skill not found.'; end if;
  if v_skill.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Only draft skills can be deleted.';
  end if;
  select * into v_agent from public.agents where id = v_skill.agent_id;
  select name into v_name from public.agent_skill_versions where skill_id = v_skill.id and is_active;
  delete from public.agent_skills where id = v_skill.id;
  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities(
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_skill_deleted', 'user', coalesce(v_actor, '工作室成员'),
    format('删除了全局 Skill 草稿「%s」', coalesce(v_name, v_skill.slug)), v_skill.id
  );
  return true;
end;
$$;

revoke all on function public.create_agent_skill(text,text,text,text,text,text,text,text,text[],text,jsonb,text) from public, anon;
revoke all on function public.save_agent_skill_version(uuid,text,text,text,text,text,text,text[],text,jsonb,text) from public, anon;
revoke all on function public.set_agent_skill_status(uuid,text) from public, anon;
revoke all on function public.rollback_agent_skill(uuid,integer) from public, anon;
revoke all on function public.delete_draft_agent_skill(uuid) from public, anon;
grant execute on function public.create_agent_skill(text,text,text,text,text,text,text,text,text[],text,jsonb,text) to authenticated;
grant execute on function public.save_agent_skill_version(uuid,text,text,text,text,text,text,text[],text,jsonb,text) to authenticated;
grant execute on function public.set_agent_skill_status(uuid,text) to authenticated;
grant execute on function public.rollback_agent_skill(uuid,integer) to authenticated;
grant execute on function public.delete_draft_agent_skill(uuid) to authenticated;

insert into public.agent_skills(agent_id, slug, status, created_by)
select agent.id, seed.slug, 'active', null
from public.agents as agent
cross join (values
  ('plan-activity-campaign'),
  ('create-activity-marketing-content'),
  ('direct-activity-visuals'),
  ('review-activity-promotion')
) as seed(slug)
where agent.agent_type = 'marketing'
on conflict (agent_id, slug) do nothing;

insert into public.agent_skill_versions(
  skill_id, version, name, description, trigger_description, negative_triggers,
  instructions, output_requirements, allowed_tools, reference_material,
  test_cases, is_active, created_by
)
select skill.id, 1, seed.name, seed.description, seed.trigger_description,
  seed.negative_triggers, seed.instructions, seed.output_requirements,
  seed.allowed_tools, seed.reference_material, seed.test_cases, true, null
from public.agent_skills as skill
join public.agents as agent on agent.id = skill.agent_id and agent.agent_type = 'marketing'
join (values
  (
    'plan-activity-campaign',
    '活动宣传策略',
    '围绕一个确定活动制定受众、核心信息、传播节奏与平台分工。',
    '当用户要为当前活动制定宣传计划、传播策略、目标人群、卖点层级、传播阶段或平台分工时使用。',
    '不用于直接生成最终图片；不用于脱离当前活动追逐泛热点；不用于替用户决定未经确认的活动事实。',
    E'1. 先调用 get_project_context 核对活动名称、阶段和正式方案。\n2. 需要活动 Brief、历史材料、视觉规范或工作室案例时调用 search_project_knowledge。\n3. 把宣传任务约束为当前活动，确认传播目标、行动目标和受众；信息不足时只追问会改变策略的关键缺口。\n4. 提炼一个主信息、两到三个支撑卖点，并区分必须公开、可以公开和暂不公开的信息。\n5. 设计预热、招募、临近提醒、现场和复盘等适用阶段，不机械要求每个活动覆盖全部阶段。\n6. 为不同平台定义职责，但不得为了热点改变活动定位。热点只有同时满足活动相关、受众重合和有助于行动目标时才可采用。\n7. 标记所有缺乏正式依据的内容为待确认。',
    E'- 宣传目标与用户行动\n- 核心受众及其真实动机\n- 主信息与支撑卖点\n- 内容阶段和平台分工\n- 可采用与不可采用的传播角度\n- 待确认事实和风险',
    array['get_project_context','search_project_knowledge']::text[],
    E'判断优先级：活动事实 > 传播目标 > 受众需要 > 平台表达 > 热点。\n风格是策略参数，不单独改变活动核心。',
    '{"should_trigger":["为梧桐无同制定一套活动招募宣传计划。","这个活动应该面向哪些人、分几个阶段宣传？"],"should_not_trigger":["直接给我生成一张活动海报。","最近有什么热点都可以，随便追一个。"]}'::jsonb
  ),
  (
    'create-activity-marketing-content',
    '活动营销内容',
    '把已确认的活动事实和传播目标转化为小红书、微信公众号等营销草稿。',
    '当用户要求围绕当前活动写小红书图文、微信公众号文章、招募文案、临近提醒、活动回顾或项目故事时使用。',
    '不用于发布平台内容；不用于凭空补充时间、地点、价格、名额、效果或评价；不用于生成最终图片。',
    E'1. 调用 get_project_context 核对正式活动信息；需要细节、品牌语气或历史材料时调用 search_project_knowledge。\n2. 先确定平台、传播目标、目标受众和期望行动；用户已经说明时不要重复提问。\n3. 所有内容必须围绕活动本身，不能为了流量制造与活动无关的选题。\n4. 小红书内容强调真实场景、清晰钩子、滑动结构、收藏或评论理由，避免广告腔和假装亲历。\n5. 公众号内容强调完整叙事、事实脉络和长文阅读结构，不能只是拉长小红书正文。\n6. 同一事实可针对不同受众调整解释顺序、语气与例子，但不得改变事实。\n7. 输出作为内部草稿，明确待确认内容，不声称已发布。',
    E'- 平台与内容定位\n- 3–5 个标题候选\n- 可直接编辑的正文\n- 封面文案或摘要\n- 配图顺序及每张图的表达任务\n- 标签、互动引导或发布备注\n- 待确认事实',
    array['get_project_context','search_project_knowledge']::text[],
    E'小红书：标题优先简洁具体；正文有现场感；轮播每页只承担一个任务。\n微信公众号：提供标题、摘要、导语、小标题结构、正文、配图位置和文末行动。\n语气、受众和风格均作为参数处理，不为每种风格复制 Skill。',
    '{"should_trigger":["给这个活动写一篇面向上海年轻人的小红书招募笔记。","把当前项目整理成一篇微信公众号活动回顾。"],"should_not_trigger":["帮我直接发布到小红书。","把活动玩法重新设计一下。"]}'::jsonb
  ),
  (
    'direct-activity-visuals',
    '活动视觉策划',
    '把营销内容整理为封面、轮播页和可交给艺术家小熊执行的视觉 Brief。',
    '当用户要为活动宣传内容规划封面、轮播图结构、逐页信息、视觉风格或交给小熊的配图需求时使用。',
    '不直接声称已经生成图片；不重新决定活动机制；不把固定科技风强加给所有活动。',
    E'1. 核对内容目标、平台、画幅、页数和现有项目视觉规范。需要正式事实调用 get_project_context，需要视觉规范和素材调用 search_project_knowledge。\n2. 每一页只安排一个传播任务，先设计信息节奏，再选择视觉风格。\n3. 风格必须从活动气质、受众和内容密度推导，不默认科技、杂志或热点模板。\n4. 对每页写清标题、核心信息、构图、主视觉、文字安全区、配色、必须保留和禁止内容。\n5. 中文文字较多时优先让图片模型生成背景与构图，正文留给后期排版。\n6. 形成结构化 Visual Brief 供用户检查，再交给小熊执行；不得声称图片已经生成。',
    E'- 画幅、页数与统一视觉规范\n- 页面结构总览\n- 每页的传播任务、文案、构图和视觉元素\n- 每页生图或设计指令\n- 必须保留与禁止项\n- 可直接交给小熊的完整 Visual Brief',
    array['get_project_context','search_project_knowledge']::text[],
    E'默认小红书图文可采用 3:4 竖版，但用户指定媒介时以用户要求为准。\n检查手机端可读性、页面递进、风格一致性、活动相关性和素材版权。',
    '{"should_trigger":["把刚才的小红书正文拆成六页轮播图，并整理给小熊。","这个活动招募内容的封面和每页应该怎么设计？"],"should_not_trigger":["直接画一张海报。","帮我调整活动路线。"]}'::jsonb
  ),
  (
    'review-activity-promotion',
    '活动宣传复盘',
    '基于真实发布结果总结有效表达、受众反馈和下一轮活动宣传改进。',
    '当用户提供活动宣传的阅读、互动、报名、到场、评论或内容表现，并要求复盘或改进时使用。',
    '不在没有数据时编造表现；不把账号涨粉作为唯一目标；不把一次表现直接推断为长期规律。',
    E'1. 明确本次活动的宣传目标和用户行动，区分曝光、理解、报名、到场和口碑。\n2. 只使用用户提供或知识库中可验证的数据；需要历史材料时调用 search_project_knowledge。\n3. 对比不同内容、平台、受众、发布时间和表达角度，区分事实、合理推断和未知。\n4. 判断哪些结果真正服务活动目标，而不是只看点赞和流量。\n5. 提炼可复用模式、失效原因和下一轮可验证假设，避免把偶然结果绝对化。\n6. 输出少量明确行动，不为了增加动作而追逐无关热点。',
    E'- 原目标与实际结果\n- 有效和无效的表达\n- 受众反馈与行动转化\n- 证据、推断和未知的区分\n- 可复用规律\n- 下一轮 3–5 个改进动作',
    array['get_project_context','search_project_knowledge']::text[],
    E'活动宣传的首要指标由活动目标决定。招募期重点可能是有效报名，现场期可能是到场和参与，复盘期可能是理解和口碑；账号流量只是一种中间信号。',
    '{"should_trigger":["这几篇活动招募笔记的数据都在这里，帮我复盘。","为什么阅读量高但实际报名很少？"],"should_not_trigger":["没有任何数据，直接告诉我这次宣传哪里失败。","帮我分析整个账号未来一年怎么涨粉。"]}'::jsonb
  )
) as seed(
  slug, name, description, trigger_description, negative_triggers,
  instructions, output_requirements, allowed_tools, reference_material, test_cases
) on seed.slug = skill.slug
where not exists (
  select 1 from public.agent_skill_versions as version where version.skill_id = skill.id
);

comment on table public.agent_skills is
  'Workspace-global skills assigned to one Agent. Skills never depend on project_id.';
comment on table public.agent_skill_versions is
  'Immutable versions of Agent workflows. Runtime loads only active versions belonging to active skills.';

commit;
