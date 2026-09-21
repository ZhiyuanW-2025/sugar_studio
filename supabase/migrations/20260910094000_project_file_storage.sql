begin;

alter table public.project_files
  add column mime_type text not null default 'application/octet-stream',
  add column size bigint not null default 0,
  add column uploaded_by uuid references auth.users (id) on delete set null,
  add constraint project_files_mime_type_not_blank check (length(btrim(mime_type)) > 0),
  add constraint project_files_size_nonnegative check (size >= 0),
  add constraint project_files_path_matches_project check (
    split_part(storage_path, '/', 1) = project_id::text
  );

create index project_files_uploaded_by_idx
  on public.project_files (uploaded_by, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.project_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function private.project_id_from_storage_path(text) from public;
grant execute on function private.project_id_from_storage_path(text) to authenticated;

create policy project_files_storage_select_members
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and private.is_project_member(private.project_id_from_storage_path(name))
);

create policy project_files_storage_insert_members
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and private.is_project_member(private.project_id_from_storage_path(name))
  and coalesce((storage.foldername(name))[2], '')
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

create policy project_files_storage_delete_members
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-files'
  and private.is_project_member(private.project_id_from_storage_path(name))
);

drop policy project_files_insert_members on public.project_files;
drop policy project_files_update_members on public.project_files;
drop policy project_files_delete_members on public.project_files;

revoke insert, update, delete on table public.project_files from authenticated;

create function public.register_project_file(
  p_id uuid,
  p_project_id uuid,
  p_file_name text,
  p_storage_path text,
  p_file_type text,
  p_mime_type text,
  p_size bigint
)
returns public.project_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_file public.project_files%rowtype;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  if p_id is null
     or nullif(btrim(p_file_name), '') is null
     or nullif(btrim(p_file_type), '') is null
     or nullif(btrim(p_mime_type), '') is null
     or p_size < 0
     or p_storage_path !~ ('^' || p_project_id::text || '/' || p_id::text || '/[^/]+$') then
    raise exception using errcode = '23514', message = 'Invalid project file metadata.';
  end if;

  insert into public.project_files (
    id, project_id, file_name, storage_path, file_type, mime_type, size, uploaded_by
  )
  values (
    p_id,
    p_project_id,
    btrim(p_file_name),
    p_storage_path,
    lower(btrim(p_file_type)),
    btrim(p_mime_type),
    p_size,
    caller_id
  )
  returning * into v_file;

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into v_actor
  from public.profiles as profile
  where profile.id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  )
  values (
    p_project_id,
    caller_id,
    'project_file_uploaded',
    'user',
    coalesce(v_actor, '项目成员'),
    format('上传了项目文件：%s', btrim(p_file_name)),
    p_id
  );

  return v_file;
end;
$$;

create function public.remove_project_file(
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
  v_path text;
  v_file_name text;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select storage_path, file_name
  into v_path, v_file_name
  from public.project_files
  where id = p_file_id and project_id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Project file not found.';
  end if;

  delete from public.project_files where id = p_file_id;

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into v_actor
  from public.profiles as profile
  where profile.id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  )
  values (
    p_project_id,
    caller_id,
    'project_file_deleted',
    'user',
    coalesce(v_actor, '项目成员'),
    format('删除了项目文件：%s', v_file_name),
    p_file_id
  );

  return v_path;
end;
$$;

revoke all on function public.register_project_file(uuid, uuid, text, text, text, text, bigint) from public, anon;
revoke all on function public.remove_project_file(uuid, uuid) from public, anon;
grant execute on function public.register_project_file(uuid, uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.remove_project_file(uuid, uuid) to authenticated;

comment on function public.register_project_file(uuid, uuid, text, text, text, text, bigint)
  is 'Registers an uploaded Storage object and records project activity.';
comment on function public.remove_project_file(uuid, uuid)
  is 'Removes project file metadata and records project activity after Storage deletion.';

commit;
