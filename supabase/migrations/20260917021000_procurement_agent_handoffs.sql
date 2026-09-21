begin;

alter table public.handoff_tasks
  drop constraint handoff_tasks_source_agent_check,
  drop constraint handoff_tasks_target_agent_check,
  add constraint handoff_tasks_source_agent_check
    check (source_agent in ('planning','coding','design','client','procurement')),
  add constraint handoff_tasks_target_agent_check
    check (target_agent in ('planning','coding','design','client','procurement'));

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
  if p_source_agent not in ('planning','coding','design','client','procurement')
     or p_target_agent not in ('planning','coding','design','client','procurement')
     or p_source_agent=p_target_agent
     or p_task_kind not in ('brief','result','feedback','change_request','client_material')
     or p_priority not in ('low','normal','high')
     or nullif(btrim(p_title),'') is null
     or nullif(btrim(p_content),'') is null then
    raise exception using errcode='23514',message='Invalid collaboration task.';
  end if;

  select * into source_thread from public.agent_threads
  where project_id=p_project_id and user_id=caller_id and agent_type=p_source_agent;
  if not found then
    raise exception using errcode='42501',message='Source thread access denied.';
  end if;
  if exists(
    select 1 from unnest(p_project_file_ids) id
    where not exists(select 1 from public.project_files file where file.id=id and file.project_id=p_project_id)
  ) then
    raise exception using errcode='42501',message='Project attachment access denied.';
  end if;
  if exists(
    select 1 from unnest(p_image_generation_ids) id
    where not exists(
      select 1 from public.image_generations image
      where image.id=id and image.project_id=p_project_id and image.user_id=caller_id and image.status='completed'
    )
  ) then
    raise exception using errcode='42501',message='Image attachment access denied.';
  end if;

  insert into public.agent_threads(project_id,user_id,agent_type,title)
  values(
    p_project_id,
    caller_id,
    p_target_agent,
    case p_target_agent
      when 'planning' then '制作人小花'
      when 'coding' then '工程师牛牛'
      when 'design' then '艺术家小熊'
      when 'client' then '客户伙伴小雪'
      else '金牌买手拉夫'
    end
  )
  on conflict(user_id,project_id,agent_type) do update set updated_at=now()
  returning * into target_thread;

  insert into public.handoff_tasks(
    project_id,source_agent,target_agent,source_thread_id,target_thread_id,title,content,
    status,task_kind,priority,created_by,approved_at,delivered_at
  ) values(
    p_project_id,p_source_agent,p_target_agent,source_thread.id,target_thread.id,btrim(p_title),btrim(p_content),
    'delivered',p_task_kind,p_priority,caller_id,now(),now()
  ) returning * into task;

  foreach item_id in array p_project_file_ids loop
    insert into public.handoff_attachments(handoff_task_id,project_file_id) values(task.id,item_id);
  end loop;
  foreach item_id in array p_image_generation_ids loop
    insert into public.handoff_attachments(handoff_task_id,image_generation_id) values(task.id,item_id);
  end loop;

  source_name := case p_source_agent
    when 'planning' then '制作人小花'
    when 'coding' then '工程师牛牛'
    when 'design' then '艺术家小熊'
    when 'client' then '客户伙伴小雪'
    else '金牌买手拉夫'
  end;
  target_name := case p_target_agent
    when 'planning' then '制作人小花'
    when 'coding' then '工程师牛牛'
    when 'design' then '艺术家小熊'
    when 'client' then '客户伙伴小雪'
    else '金牌买手拉夫'
  end;
  message_text := format('【来自%s的已确认协作任务】\n%s\n\n%s\n\n协作任务 ID：%s',source_name,btrim(p_title),btrim(p_content),task.id);
  insert into public.messages(thread_id,request_id,role,content)
  values(target_thread.id,task.id,'system',message_text);
  insert into public.project_activities(project_id,user_id,event_type,actor_type,actor,summary,related_entity_id)
  values(
    p_project_id,caller_id,'collaboration_task_delivered','user',
    coalesce((select display_name from public.profiles where id=caller_id),'项目成员'),
    format('确认将%s交给%s：%s',source_name,target_name,btrim(p_title)),task.id
  );
  return jsonb_build_object(
    'id',task.id,'sourceAgent',p_source_agent,'targetAgent',p_target_agent,
    'title',task.title,'content',task.content,'status',task.status,'taskKind',task.task_kind,
    'priority',task.priority,'targetThreadId',target_thread.id
  );
end;
$$;

comment on function public.deliver_generic_handoff(uuid,text,text,text,text,text,text,uuid[],uuid[]) is
  'Delivers confirmed project-scoped work between any Sugar Agent, including procurement Agent LaFu.';

commit;
