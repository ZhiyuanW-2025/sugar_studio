begin;

alter table public.project_files
  add column checksum text,
  add column version integer not null default 1 check (version > 0),
  add column replaces_file_id uuid references public.project_files (id) on delete set null,
  add column superseded_at timestamptz;

alter table public.company_files
  add column checksum text,
  add column version integer not null default 1 check (version > 0),
  add column replaces_file_id uuid references public.company_files (id) on delete set null,
  add column superseded_at timestamptz;

alter table public.knowledge_ingestion_jobs
  add column max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  add column next_attempt_at timestamptz not null default now(),
  add column progress integer not null default 0 check (progress between 0 and 100),
  add column progress_message text;

create unique index project_files_active_checksum_key
  on public.project_files (project_id, checksum)
  where checksum is not null and superseded_at is null;
create unique index company_files_active_checksum_key
  on public.company_files (checksum)
  where checksum is not null and superseded_at is null;
create index project_files_version_chain_idx on public.project_files (replaces_file_id, version desc);
create index company_files_version_chain_idx on public.company_files (replaces_file_id, version desc);
create index knowledge_jobs_ready_to_run_idx
  on public.knowledge_ingestion_jobs (next_attempt_at, created_at)
  where status = 'pending';

create table public.knowledge_search_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  query_text text not null check (length(btrim(query_text)) > 0),
  scope text not null check (scope in ('all', 'project', 'company')),
  result_count integer not null default 0 check (result_count >= 0),
  top_score double precision,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  result_chunk_ids uuid[] not null default '{}',
  feedback text check (feedback is null or feedback in ('helpful', 'not_helpful')),
  created_at timestamptz not null default now()
);

create index knowledge_search_events_project_created_idx
  on public.knowledge_search_events (project_id, created_at desc);

alter table public.knowledge_search_events enable row level security;
revoke all on table public.knowledge_search_events from anon, authenticated;
grant select, update on table public.knowledge_search_events to authenticated;
grant select, insert, update, delete on table public.knowledge_search_events to service_role;

create policy knowledge_search_events_select_own
on public.knowledge_search_events for select to authenticated
using (user_id = (select auth.uid()) and private.is_project_member(project_id));

create policy knowledge_search_events_feedback_own
on public.knowledge_search_events for update to authenticated
using (user_id = (select auth.uid()) and private.is_project_member(project_id))
with check (user_id = (select auth.uid()) and private.is_project_member(project_id));

create or replace function private.is_knowledge_file_supported(file_type text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select lower(file_type) in ('pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'webp');
$$;

create function public.register_project_file_v2(
  p_id uuid,
  p_project_id uuid,
  p_file_name text,
  p_storage_path text,
  p_file_type text,
  p_mime_type text,
  p_size bigint,
  p_checksum text,
  p_replaces_file_id uuid default null
)
returns public.project_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  previous_file public.project_files%rowtype;
  next_version integer := 1;
  new_file public.project_files%rowtype;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_id is null or nullif(btrim(p_file_name), '') is null
     or nullif(btrim(p_file_type), '') is null or nullif(btrim(p_mime_type), '') is null
     or p_size < 0 or p_checksum !~ '^[0-9a-f]{64}$'
     or p_storage_path !~ ('^' || p_project_id::text || '/' || p_id::text || '/[^/]+$') then
    raise exception using errcode = '23514', message = 'Invalid project file metadata.';
  end if;

  if exists (
    select 1 from public.project_files
    where project_id = p_project_id and checksum = p_checksum and superseded_at is null
  ) then
    raise exception using errcode = '23505', message = 'Duplicate active project file.';
  end if;

  if p_replaces_file_id is not null then
    select * into previous_file from public.project_files
    where id = p_replaces_file_id and project_id = p_project_id and superseded_at is null
    for update;
    if previous_file.id is null then
      raise exception using errcode = 'P0002', message = 'Previous project file not found.';
    end if;
    next_version := previous_file.version + 1;
    update public.project_files set superseded_at = now() where id = previous_file.id;
  end if;

  insert into public.project_files (
    id, project_id, file_name, storage_path, file_type, mime_type, size, uploaded_by,
    checksum, version, replaces_file_id
  ) values (
    p_id, p_project_id, btrim(p_file_name), p_storage_path, lower(btrim(p_file_type)),
    btrim(p_mime_type), p_size, caller_id, p_checksum, next_version, p_replaces_file_id
  ) returning * into new_file;

  select display_name into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id,
    case when p_replaces_file_id is null then 'project_file_uploaded' else 'project_file_version_uploaded' end,
    'user', coalesce(actor_name, '项目成员'),
    case when p_replaces_file_id is null
      then format('上传了项目文件：%s', btrim(p_file_name))
      else format('上传了项目文件新版本 v%s：%s', next_version, btrim(p_file_name)) end,
    p_id
  );
  return new_file;
end;
$$;

create function public.register_company_file_v2(
  p_id uuid,
  p_file_name text,
  p_storage_path text,
  p_file_type text,
  p_mime_type text,
  p_size bigint,
  p_checksum text,
  p_replaces_file_id uuid default null
)
returns public.company_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  previous_file public.company_files%rowtype;
  next_version integer := 1;
  new_file public.company_files%rowtype;
begin
  if caller_id is null or not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_id is null or nullif(btrim(p_file_name), '') is null
     or nullif(btrim(p_file_type), '') is null or nullif(btrim(p_mime_type), '') is null
     or p_size < 0 or p_checksum !~ '^[0-9a-f]{64}$'
     or p_storage_path !~ ('^' || p_id::text || '/[^/]+$') then
    raise exception using errcode = '23514', message = 'Invalid company file metadata.';
  end if;

  if exists (select 1 from public.company_files where checksum = p_checksum and superseded_at is null) then
    raise exception using errcode = '23505', message = 'Duplicate active company file.';
  end if;

  if p_replaces_file_id is not null then
    select * into previous_file from public.company_files
    where id = p_replaces_file_id and superseded_at is null for update;
    if previous_file.id is null then
      raise exception using errcode = 'P0002', message = 'Previous company file not found.';
    end if;
    next_version := previous_file.version + 1;
    update public.company_files set superseded_at = now() where id = previous_file.id;
  end if;

  insert into public.company_files (
    id, file_name, storage_path, file_type, mime_type, size, uploaded_by,
    checksum, version, replaces_file_id
  ) values (
    p_id, btrim(p_file_name), p_storage_path, lower(btrim(p_file_type)), btrim(p_mime_type),
    p_size, caller_id, p_checksum, next_version, p_replaces_file_id
  ) returning * into new_file;
  return new_file;
end;
$$;

update public.knowledge_documents
set status = 'pending', error_message = null
where status = 'unsupported'
  and (
    exists (select 1 from public.project_files f where f.id = knowledge_documents.project_file_id and f.file_type in ('png', 'jpg', 'jpeg', 'webp'))
    or exists (select 1 from public.company_files f where f.id = knowledge_documents.company_file_id and f.file_type in ('png', 'jpg', 'jpeg', 'webp'))
  );

insert into public.knowledge_ingestion_jobs (document_id, requested_by)
select document.id, coalesce(project_file.uploaded_by, company_file.uploaded_by)
from public.knowledge_documents document
left join public.project_files project_file on project_file.id = document.project_file_id
left join public.company_files company_file on company_file.id = document.company_file_id
where document.status = 'pending'
  and not exists (
    select 1 from public.knowledge_ingestion_jobs job
    where job.document_id = document.id and job.status in ('pending', 'processing')
  );

revoke all on function public.register_project_file_v2(uuid, uuid, text, text, text, text, bigint, text, uuid) from public, anon;
revoke all on function public.register_company_file_v2(uuid, text, text, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.register_project_file_v2(uuid, uuid, text, text, text, text, bigint, text, uuid) to authenticated;
grant execute on function public.register_company_file_v2(uuid, text, text, text, text, bigint, text, uuid) to authenticated;

comment on table public.knowledge_search_events is 'Search quality telemetry and explicit user feedback without model credentials.';

commit;
