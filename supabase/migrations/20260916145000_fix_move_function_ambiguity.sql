begin;

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
  v_source_document_id uuid;
  v_target_document_id uuid;
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
  into source_path, source_name, v_source_document_id
  from public.project_files as file
  left join public.knowledge_documents as document on document.project_file_id = file.id
  where file.id = p_source_file_id and file.project_id = p_source_project_id
  for update of file;
  if source_path is null then
    raise exception using errcode = 'P0002', message = 'Source project file not found.';
  end if;

  select document.id into v_target_document_id
  from public.project_files as file
  left join public.knowledge_documents as document on document.project_file_id = file.id
  where file.id = p_target_file_id and file.project_id = p_target_project_id;
  if v_target_document_id is null then
    raise exception using errcode = 'P0002', message = 'Target knowledge document not found.';
  end if;

  if v_source_document_id is not null then
    update public.feishu_knowledge_change_proposals
    set source_knowledge_document_id = v_target_document_id
    where source_knowledge_document_id = v_source_document_id;
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

commit;
