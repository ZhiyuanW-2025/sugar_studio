begin;

alter table public.feishu_knowledge_change_proposals
  drop constraint if exists feishu_knowledge_change_proposals_source_knowledge_document_id_fkey,
  drop constraint if exists feishu_change_payload_matches_action;

alter table public.feishu_knowledge_change_proposals
  add constraint feishu_knowledge_change_proposals_source_knowledge_document_id_fkey
    foreign key (source_knowledge_document_id)
    references public.knowledge_documents(id)
    on delete set null,
  add constraint feishu_change_payload_matches_action check (
    (action = 'create_document' and target_document_id is null and source_knowledge_document_id is null and content is not null and old_text is null and new_text is null)
    or
    (action = 'append_content' and target_document_id is not null and source_knowledge_document_id is null and content is not null and old_text is null and new_text is null)
    or
    (action = 'replace_text' and target_document_id is not null and source_knowledge_document_id is null and content is null and old_text is not null and new_text is not null)
    or
    (action = 'upload_file' and target_document_id is null and content is null and old_text is null and new_text is null
      and (source_knowledge_document_id is not null or status in ('applied', 'cancelled', 'failed', 'conflict')))
  );

create or replace function public.complete_project_file_move(
  p_source_project_id uuid,
  p_source_file_id uuid,
  p_target_project_id uuid,
  p_target_file_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  source_path text;
  source_name text;
  source_document_id uuid;
  target_document_id uuid;
  actor_name text;
begin
  if caller_id is null
    or not private.is_project_member(p_source_project_id)
    or not private.is_project_member(p_target_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_source_project_id = p_target_project_id then
    raise exception using errcode = '23514', message = 'Source and target projects must differ.';
  end if;

  select file.storage_path, file.file_name, document.id
  into source_path, source_name, source_document_id
  from public.project_files as file
  left join public.knowledge_documents as document on document.project_file_id = file.id
  where file.id = p_source_file_id and file.project_id = p_source_project_id
  for update of file;
  if source_path is null then
    raise exception using errcode = 'P0002', message = 'Source project file not found.';
  end if;

  select document.id into target_document_id
  from public.project_files as file
  left join public.knowledge_documents as document on document.project_file_id = file.id
  where file.id = p_target_file_id and file.project_id = p_target_project_id;
  if target_document_id is null then
    raise exception using errcode = 'P0002', message = 'Target knowledge document not found.';
  end if;

  if source_document_id is not null then
    update public.feishu_knowledge_change_proposals
    set source_knowledge_document_id = target_document_id
    where source_knowledge_document_id = source_document_id;
  end if;

  delete from public.project_files where id = p_source_file_id and project_id = p_source_project_id;

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into actor_name from public.profiles as profile where profile.id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_source_project_id, caller_id, 'project_file_moved_out', 'user',
    coalesce(actor_name, '项目成员'),
    format('将项目文件移动到其他项目：%s', source_name),
    p_target_file_id
  );
  return source_path;
end;
$$;

create or replace function public.remove_project_file(
  p_project_id uuid,
  p_file_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  file_path text;
  file_name text;
  document_id uuid;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select file.storage_path, file.file_name, document.id
  into file_path, file_name, document_id
  from public.project_files as file
  left join public.knowledge_documents as document on document.project_file_id = file.id
  where file.id = p_file_id and file.project_id = p_project_id
  for update of file;
  if file_path is null then
    raise exception using errcode = 'P0002', message = 'Project file not found.';
  end if;

  if document_id is not null and exists (
    select 1 from public.feishu_knowledge_change_proposals
    where source_knowledge_document_id = document_id and status in ('pending', 'applying')
  ) then
    raise exception using errcode = '55000', message = 'File has an active Feishu operation.';
  end if;

  delete from public.project_files where id = p_file_id and project_id = p_project_id;

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into actor_name from public.profiles as profile where profile.id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'project_file_deleted', 'user',
    coalesce(actor_name, '项目成员'), format('删除了项目文件：%s', file_name), null
  );
  return file_path;
end;
$$;

revoke all on function public.complete_project_file_move(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.complete_project_file_move(uuid, uuid, uuid, uuid) to authenticated;

comment on function public.complete_project_file_move(uuid, uuid, uuid, uuid)
  is 'Atomically transfers Feishu proposal references to the copied target document and removes source metadata.';

commit;
