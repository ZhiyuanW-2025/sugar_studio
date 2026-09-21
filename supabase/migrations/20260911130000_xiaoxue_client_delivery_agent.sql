begin;

alter table public.agent_threads
  drop constraint agent_threads_agent_type_check,
  add constraint agent_threads_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client'));

alter table public.agent_model_preferences
  drop constraint agent_model_preferences_agent_type_check,
  add constraint agent_model_preferences_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client'));

alter table public.agents
  drop constraint agents_agent_type_check,
  add constraint agents_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client'));

insert into public.agents (agent_type, name, role_title, description)
values (
  'client',
  '客户伙伴小雪',
  '客户交付',
  '负责把已确认的项目内容整理成面向 B 端客户的正式材料与沟通草稿。'
)
on conflict (agent_type) do update set
  name = excluded.name,
  role_title = excluded.role_title,
  description = excluded.description;

insert into public.agent_prompt_versions (
  agent_id,
  version,
  instructions,
  is_active,
  created_by
)
select
  agent.id,
  1,
  $prompt$你是 Sugar Agent 中的客户伙伴小雪，负责把已经确认的项目内容转化为适合 B 端客户阅读、讨论和确认的正式材料或沟通草稿。你是客户交付工作通道，不是客服机器人，也不负责重新策划项目。

你的工作包括：客户提案、方案说明、会议纪要、项目进度汇报、修改意见回复、执行说明、交付确认、正式邮件和企业微信回复草稿。先识别材料类型、目标读者、沟通目的、必须包含的事实、语气和期望格式；信息不足时只提出最少量澄清问题。

涉及当前项目名称、状态、阶段、正式方案或已经确认的事实时，必须优先调用 get_project_context，不得根据模糊聊天记忆猜测。项目正式数据与聊天内容冲突时，以正式数据为准。当前工具只提供结构化项目概况，不能读取项目文件、附件、客户合同或完整知识库；不得假装已经查看这些内容。

你不能自行修改项目策划、价格、范围、交期或对客户作出承诺。用户提供的客户意见可以整理为待确认事项，但不能自动写入正式项目状态。所有输出默认都是内部草稿；不得声称已经发送邮件、企业微信或任何客户材料。

输出使用专业、清晰、克制的中文。面向客户时减少内部术语，明确下一步、待确认事项和责任边界。生成正式材料时使用清晰标题和结构；生成沟通回复时先给可直接复制的正文，必要时再补充内部提醒。$prompt$,
  true,
  null
from public.agents as agent
where agent.agent_type = 'client'
  and not exists (
    select 1
    from public.agent_prompt_versions as prompt
    where prompt.agent_id = agent.id
  );

create or replace function public.resolve_user_model_config(
  p_user_id uuid,
  p_agent_type text
)
returns table (
  provider text,
  model text,
  api_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_agent_type not in ('planning', 'coding', 'design', 'client') then
    raise exception 'Unsupported agent type.' using errcode = '22023';
  end if;

  return query
  select
    config.provider,
    config.model,
    secret.decrypted_secret
  from public.user_model_configs as config
  join vault.decrypted_secrets as secret
    on secret.id = config.api_key_secret_id
  where config.user_id = p_user_id
    and config.id = coalesce(
      (
        select preference.model_config_id
        from public.agent_model_preferences as preference
        where preference.user_id = p_user_id
          and preference.agent_type = p_agent_type
      ),
      (
        select default_config.id
        from public.user_model_configs as default_config
        where default_config.user_id = p_user_id
          and default_config.is_default
        limit 1
      )
    )
  limit 1;
end;
$$;

create or replace function public.save_agent_prompt(
  p_agent_type text,
  p_instructions text
)
returns public.agent_prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_agent public.agents%rowtype;
  v_version integer;
  v_result public.agent_prompt_versions%rowtype;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_agent_type not in ('planning', 'coding', 'design', 'client')
     or nullif(btrim(p_instructions), '') is null then
    raise exception using errcode = '23514', message = 'Invalid prompt.';
  end if;

  select * into v_agent
  from public.agents
  where agent_type = p_agent_type
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;

  select coalesce(max(version), 0) + 1
  into v_version
  from public.agent_prompt_versions
  where agent_id = v_agent.id;

  update public.agent_prompt_versions
  set is_active = false
  where agent_id = v_agent.id
    and is_active;

  insert into public.agent_prompt_versions (
    agent_id, version, instructions, is_active, created_by
  ) values (
    v_agent.id, v_version, btrim(p_instructions), true, caller_id
  )
  returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '工作室成员')
  into v_actor
  from public.profiles
  where id = caller_id;

  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id,
    caller_id,
    'agent_prompt_changed',
    'user',
    coalesce(v_actor, '工作室成员'),
    format('更新了全局%s提示词至 v%s', v_agent.name, v_version),
    v_result.id
  );

  return v_result;
end;
$$;

comment on table public.agents is
  'Workspace-global Agent definitions: the project lead Xiaohua plus on-demand engineering, visual, and client-delivery work lanes.';

commit;
