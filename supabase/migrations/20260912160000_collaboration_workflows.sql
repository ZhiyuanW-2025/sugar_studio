begin;

alter table public.handoff_tasks
  drop constraint handoff_tasks_source_agent_check,
  drop constraint handoff_tasks_target_agent_check,
  drop constraint handoff_tasks_status_check,
  add constraint handoff_tasks_source_agent_check check (source_agent in ('planning','coding','design','client')),
  add constraint handoff_tasks_target_agent_check check (target_agent in ('planning','coding','design','client')),
  add constraint handoff_tasks_status_check check (status in ('draft','approved','delivered','in_progress','blocked','completed','cancelled')),
  add column task_kind text not null default 'brief' check (task_kind in ('brief','result','feedback','change_request','client_material')),
  add column priority text not null default 'normal' check (priority in ('low','normal','high')),
  add column due_at timestamptz,
  add column completed_at timestamptz,
  add column updated_at timestamptz not null default now();

create trigger handoff_tasks_set_updated_at before update on public.handoff_tasks
for each row execute function public.set_sugar_agent_updated_at();
create index handoff_tasks_project_status_updated_idx on public.handoff_tasks(project_id,status,updated_at desc);

create table public.handoff_attachments (
  id uuid primary key default gen_random_uuid(),
  handoff_task_id uuid not null references public.handoff_tasks(id) on delete cascade,
  project_file_id uuid references public.project_files(id) on delete cascade,
  company_file_id uuid references public.company_files(id) on delete cascade,
  image_generation_id uuid references public.image_generations(id) on delete cascade,
  artifact_version_id uuid references public.artifact_versions(id) on delete cascade,
  client_deliverable_version_id uuid references public.client_deliverable_versions(id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now(),
  constraint handoff_attachments_exactly_one_source check (num_nonnulls(project_file_id,company_file_id,image_generation_id,artifact_version_id,client_deliverable_version_id)=1)
);
create index handoff_attachments_task_idx on public.handoff_attachments(handoff_task_id);
alter table public.handoff_attachments enable row level security;
revoke all on table public.handoff_attachments from anon, authenticated;
grant select on table public.handoff_attachments to authenticated;
grant select,insert,update,delete on table public.handoff_attachments to service_role;
create policy handoff_attachments_select_members on public.handoff_attachments for select to authenticated using (exists (
  select 1 from public.handoff_tasks task where task.id=handoff_attachments.handoff_task_id and private.is_project_member(task.project_id)
));

create function public.deliver_generic_handoff(
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
declare caller_id uuid := (select auth.uid()); source_thread public.agent_threads%rowtype; target_thread public.agent_threads%rowtype; task public.handoff_tasks%rowtype; target_name text; source_name text; message_text text; item_id uuid;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then raise exception using errcode='42501',message='Project access denied.'; end if;
  if p_source_agent not in ('planning','coding','design','client') or p_target_agent not in ('planning','coding','design','client') or p_source_agent=p_target_agent
    or p_task_kind not in ('brief','result','feedback','change_request','client_material') or p_priority not in ('low','normal','high')
    or nullif(btrim(p_title),'') is null or nullif(btrim(p_content),'') is null then raise exception using errcode='23514',message='Invalid collaboration task.'; end if;
  select * into source_thread from public.agent_threads where project_id=p_project_id and user_id=caller_id and agent_type=p_source_agent;
  if not found then raise exception using errcode='42501',message='Source thread access denied.'; end if;
  if exists(select 1 from unnest(p_project_file_ids) id where not exists(select 1 from public.project_files file where file.id=id and file.project_id=p_project_id)) then raise exception using errcode='42501',message='Project attachment access denied.'; end if;
  if exists(select 1 from unnest(p_image_generation_ids) id where not exists(select 1 from public.image_generations image where image.id=id and image.project_id=p_project_id and image.user_id=caller_id and image.status='completed')) then raise exception using errcode='42501',message='Image attachment access denied.'; end if;
  insert into public.agent_threads(project_id,user_id,agent_type,title) values(p_project_id,caller_id,p_target_agent,case p_target_agent when 'planning' then '策划师小花' when 'coding' then '工程师牛牛' when 'design' then '艺术家小熊' else '客户伙伴小雪' end)
  on conflict(user_id,project_id,agent_type) do update set updated_at=now() returning * into target_thread;
  insert into public.handoff_tasks(project_id,source_agent,target_agent,source_thread_id,target_thread_id,title,content,status,task_kind,priority,created_by,approved_at,delivered_at)
  values(p_project_id,p_source_agent,p_target_agent,source_thread.id,target_thread.id,btrim(p_title),btrim(p_content),'delivered',p_task_kind,p_priority,caller_id,now(),now()) returning * into task;
  foreach item_id in array p_project_file_ids loop insert into public.handoff_attachments(handoff_task_id,project_file_id) values(task.id,item_id); end loop;
  foreach item_id in array p_image_generation_ids loop insert into public.handoff_attachments(handoff_task_id,image_generation_id) values(task.id,item_id); end loop;
  source_name := case p_source_agent when 'planning' then '策划师小花' when 'coding' then '工程师牛牛' when 'design' then '艺术家小熊' else '客户伙伴小雪' end;
  target_name := case p_target_agent when 'planning' then '策划师小花' when 'coding' then '工程师牛牛' when 'design' then '艺术家小熊' else '客户伙伴小雪' end;
  message_text := format('【来自%s的已确认协作任务】\n%s\n\n%s\n\n协作任务 ID：%s',source_name,btrim(p_title),btrim(p_content),task.id);
  insert into public.messages(thread_id,request_id,role,content) values(target_thread.id,task.id,'system',message_text);
  insert into public.project_activities(project_id,user_id,event_type,actor_type,actor,summary,related_entity_id)
  values(p_project_id,caller_id,'collaboration_task_delivered','user',coalesce((select display_name from public.profiles where id=caller_id),'项目成员'),format('确认将%s交给%s：%s',source_name,target_name,btrim(p_title)),task.id);
  return jsonb_build_object('id',task.id,'sourceAgent',p_source_agent,'targetAgent',p_target_agent,'title',task.title,'content',task.content,'status',task.status,'taskKind',task.task_kind,'priority',task.priority,'targetThreadId',target_thread.id);
end;
$$;

create function public.update_handoff_task_status(p_task_id uuid,p_status text)
returns public.handoff_tasks language plpgsql security definer set search_path=''
as $$
declare caller_id uuid := (select auth.uid()); task public.handoff_tasks%rowtype;
begin
  select * into task from public.handoff_tasks where id=p_task_id for update;
  if caller_id is null or task.id is null or not private.is_project_member(task.project_id) then raise exception using errcode='42501',message='Task access denied.'; end if;
  if p_status not in ('delivered','in_progress','blocked','completed','cancelled') then raise exception using errcode='23514',message='Invalid task status.'; end if;
  update public.handoff_tasks set status=p_status,completed_at=case when p_status='completed' then now() else null end where id=task.id returning * into task;
  insert into public.project_activities(project_id,user_id,event_type,actor_type,actor,summary,related_entity_id)
  values(task.project_id,caller_id,'collaboration_task_status_changed','user',coalesce((select display_name from public.profiles where id=caller_id),'项目成员'),format('将协作任务「%s」更新为 %s',task.title,p_status),task.id);
  return task;
end;
$$;

revoke all on function public.deliver_generic_handoff(uuid,text,text,text,text,text,text,uuid[],uuid[]), public.update_handoff_task_status(uuid,text) from public,anon;
grant execute on function public.deliver_generic_handoff(uuid,text,text,text,text,text,text,uuid[],uuid[]), public.update_handoff_task_status(uuid,text) to authenticated;

comment on table public.handoff_attachments is 'Project-safe references carried with an Agent collaboration task.';
commit;
