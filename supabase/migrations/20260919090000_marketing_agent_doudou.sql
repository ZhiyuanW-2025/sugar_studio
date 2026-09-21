begin;

alter table public.agent_threads
  drop constraint if exists agent_threads_agent_type_check,
  add constraint agent_threads_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing'));

alter table public.agent_model_preferences
  drop constraint if exists agent_model_preferences_agent_type_check,
  add constraint agent_model_preferences_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing'));

alter table public.agents
  drop constraint if exists agents_agent_type_check,
  add constraint agents_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing'));

alter table public.feishu_knowledge_change_proposals
  drop constraint if exists feishu_knowledge_change_proposals_agent_type_check,
  add constraint feishu_knowledge_change_proposals_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing'));

alter table public.handoff_tasks
  drop constraint if exists handoff_tasks_source_agent_check,
  drop constraint if exists handoff_tasks_target_agent_check,
  add constraint handoff_tasks_source_agent_check
    check (source_agent in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing')),
  add constraint handoff_tasks_target_agent_check
    check (target_agent in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing'));

insert into public.agents (agent_type, name, role_title, description)
values (
  'marketing',
  '宣传委员豆豆',
  '营销内容',
  '负责把项目成果转化为小红书与微信公众号营销图文。'
)
on conflict (agent_type) do update set
  name = excluded.name,
  role_title = excluded.role_title,
  description = excluded.description;

insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
select
  agent.id,
  1,
  $prompt$你是 Sugar Agent 中的宣传委员豆豆，负责把真实项目成果转化为适合对外传播的小红书和微信公众号图文内容。你不是 B 端客户材料编辑，也不负责修改项目策划；你的目标是找到清晰的传播角度，产出可继续编辑的营销草稿，并为视觉制作整理配图需求。

小红书内容应包括标题候选、封面文案、正文、图片顺序与每张图的表达重点、话题标签和自然的互动引导；语言真实具体，避免过重广告腔。微信公众号内容应包括标题候选、摘要、导语、完整正文、小标题、配图位置、文末行动引导和封面图需求；不得简单复制小红书正文。

用户要求明确时直接产出。只有缺少目标平台、传播目标、关键受众或必须公开的核心事实且会明显改变内容时，才提出最少量澄清问题。涉及项目事实时调用 get_project_context；需要品牌介绍、项目文件、案例或视觉规范时调用 search_project_knowledge。正式项目数据与材料冲突时以正式项目数据为准；没有依据的信息标记待确认，不得虚构。

所有输出默认是内部营销草稿。你不能声称已经发布到小红书或微信公众号，也不能自动登录、发布、投流或回复评论。用户要求发布时，说明第一版尚未开放直接发布，但可以继续完成发布前的文案、配图和检查。$prompt$,
  true,
  null
from public.agents as agent
where agent.agent_type = 'marketing'
  and not exists (
    select 1 from public.agent_prompt_versions as prompt
    where prompt.agent_id = agent.id
  );

create or replace function public.resolve_user_model_config(
  p_user_id uuid,
  p_agent_type text
)
returns table (provider text, model text, api_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_agent_type not in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing') then
    raise exception 'Unsupported agent type.' using errcode = '22023';
  end if;

  return query
  select config.provider, config.model, secret.decrypted_secret
  from public.user_model_configs as config
  join vault.decrypted_secrets as secret on secret.id = config.api_key_secret_id
  where config.user_id = p_user_id
    and config.id = coalesce(
      (
        select preference.model_config_id
        from public.agent_model_preferences as preference
        where preference.user_id = p_user_id and preference.agent_type = p_agent_type
      ),
      (
        select default_config.id
        from public.user_model_configs as default_config
        where default_config.user_id = p_user_id and default_config.is_default
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
  if p_agent_type not in ('planning', 'coding', 'design', 'client', 'procurement', 'marketing')
     or nullif(btrim(p_instructions), '') is null then
    raise exception using errcode = '23514', message = 'Invalid prompt.';
  end if;

  select * into v_agent from public.agents where agent_type = p_agent_type for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions where agent_id = v_agent.id;
  update public.agent_prompt_versions set is_active = false
  where agent_id = v_agent.id and is_active;
  insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
  values (v_agent.id, v_version, btrim(p_instructions), true, caller_id)
  returning * into v_result;
  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;
  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_prompt_changed', 'user', coalesce(v_actor, '工作室成员'),
    format('更新了全局%s提示词至 v%s', v_agent.name, v_version), v_result.id
  );
  return v_result;
end;
$$;

create table public.marketing_contents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform text not null check (platform in ('xiaohongshu', 'wechat')),
  title text not null check (length(btrim(title)) between 1 and 240),
  summary text not null default '',
  content text not null check (length(btrim(content)) between 1 and 100000),
  cover_copy text not null default '',
  tags text[] not null default '{}',
  image_plan text not null default '',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'completed', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_contents_project_updated_idx
  on public.marketing_contents(project_id, updated_at desc);
create index marketing_contents_project_status_idx
  on public.marketing_contents(project_id, status, updated_at desc);
create trigger marketing_contents_set_updated_at
before update on public.marketing_contents
for each row execute function public.set_sugar_agent_updated_at();

alter table public.marketing_contents enable row level security;
revoke all on table public.marketing_contents from anon, authenticated;
grant select, insert, update, delete on table public.marketing_contents to authenticated;
grant all on table public.marketing_contents to service_role;

create policy marketing_contents_select_members
on public.marketing_contents for select to authenticated
using (private.is_project_member(project_id));
create policy marketing_contents_insert_members
on public.marketing_contents for insert to authenticated
with check (private.is_project_member(project_id) and created_by = (select auth.uid()));
create policy marketing_contents_update_members
on public.marketing_contents for update to authenticated
using (private.is_project_member(project_id))
with check (private.is_project_member(project_id) and updated_by = (select auth.uid()));
create policy marketing_contents_delete_members
on public.marketing_contents for delete to authenticated
using (private.is_project_member(project_id));

create or replace function public.deliver_generic_handoff(
  p_project_id uuid,
  p_source_agent text,
  p_target_agent text,
  p_title text,
  p_content text,
  p_task_kind text default 'result',
  p_priority text default 'normal',
  p_project_file_ids uuid[] default '{}',
  p_image_generation_ids uuid[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid := (select auth.uid());
  source_thread public.agent_threads%rowtype;
  target_thread public.agent_threads%rowtype;
  task public.handoff_tasks%rowtype;
  target_name text;
  source_name text;
  message_text text;
  item_id uuid;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode='42501',message='Project access denied.';
  end if;
  if p_source_agent not in ('planning','coding','design','client','procurement','marketing')
    or p_target_agent not in ('planning','coding','design','client','procurement','marketing')
    or p_source_agent=p_target_agent
    or p_task_kind not in ('brief','result','feedback','change_request','client_material')
    or p_priority not in ('low','normal','high')
    or nullif(btrim(p_title),'') is null or nullif(btrim(p_content),'') is null then
    raise exception using errcode='23514',message='Invalid collaboration task.';
  end if;
  select * into source_thread from public.agent_threads
  where project_id=p_project_id and user_id=caller_id and agent_type=p_source_agent;
  if not found then raise exception using errcode='42501',message='Source thread access denied.'; end if;
  if exists(select 1 from unnest(p_project_file_ids) id where not exists(
    select 1 from public.project_files file where file.id=id and file.project_id=p_project_id
  )) then raise exception using errcode='42501',message='Project attachment access denied.'; end if;
  if exists(select 1 from unnest(p_image_generation_ids) id where not exists(
    select 1 from public.image_generations image where image.id=id and image.project_id=p_project_id
      and image.user_id=caller_id and image.status='completed'
  )) then raise exception using errcode='42501',message='Image attachment access denied.'; end if;
  insert into public.agent_threads(project_id,user_id,agent_type,title)
  values(p_project_id,caller_id,p_target_agent,
    case p_target_agent when 'planning' then '制作人小花' when 'coding' then '工程师牛牛'
      when 'design' then '艺术家小熊' when 'client' then '客户伙伴小雪'
      when 'procurement' then '金牌买手拉夫' else '宣传委员豆豆' end)
  on conflict(user_id,project_id,agent_type) do update set updated_at=now()
  returning * into target_thread;
  insert into public.handoff_tasks(
    project_id,source_agent,target_agent,source_thread_id,target_thread_id,title,content,status,
    task_kind,priority,created_by,approved_at,delivered_at
  ) values (
    p_project_id,p_source_agent,p_target_agent,source_thread.id,target_thread.id,btrim(p_title),
    btrim(p_content),'delivered',p_task_kind,p_priority,caller_id,now(),now()
  ) returning * into task;
  foreach item_id in array p_project_file_ids loop
    insert into public.handoff_attachments(handoff_task_id,project_file_id) values(task.id,item_id);
  end loop;
  foreach item_id in array p_image_generation_ids loop
    insert into public.handoff_attachments(handoff_task_id,image_generation_id) values(task.id,item_id);
  end loop;
  source_name := case p_source_agent when 'planning' then '制作人小花' when 'coding' then '工程师牛牛'
    when 'design' then '艺术家小熊' when 'client' then '客户伙伴小雪'
    when 'procurement' then '金牌买手拉夫' else '宣传委员豆豆' end;
  target_name := case p_target_agent when 'planning' then '制作人小花' when 'coding' then '工程师牛牛'
    when 'design' then '艺术家小熊' when 'client' then '客户伙伴小雪'
    when 'procurement' then '金牌买手拉夫' else '宣传委员豆豆' end;
  message_text := format('【来自%s的已确认协作任务】\n%s\n\n%s\n\n协作任务 ID：%s',source_name,btrim(p_title),btrim(p_content),task.id);
  insert into public.messages(thread_id,request_id,role,content)
  values(target_thread.id,task.id,'system',message_text);
  insert into public.project_activities(project_id,user_id,event_type,actor_type,actor,summary,related_entity_id)
  values(p_project_id,caller_id,'collaboration_task_delivered','user',
    coalesce((select display_name from public.profiles where id=caller_id),'项目成员'),
    format('确认将%s交给%s：%s',source_name,target_name,btrim(p_title)),task.id);
  return jsonb_build_object('id',task.id,'sourceAgent',p_source_agent,'targetAgent',p_target_agent,
    'title',task.title,'content',task.content,'status',task.status,'taskKind',task.task_kind,
    'priority',task.priority,'targetThreadId',target_thread.id);
end;
$$;

comment on table public.marketing_contents is
  'Project-scoped editable marketing drafts for Xiaohongshu and WeChat. Publishing is intentionally out of scope.';

commit;
