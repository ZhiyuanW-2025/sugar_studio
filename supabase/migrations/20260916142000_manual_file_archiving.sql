begin;

alter table public.projects
  add column project_kind text not null default 'standard'
    check (project_kind in ('standard', 'workspace_materials', 'inbox')),
  add column inbox_owner_id uuid references auth.users (id) on delete cascade;

alter table public.projects
  add constraint projects_inbox_owner_matches_kind check (
    (project_kind = 'inbox' and inbox_owner_id is not null)
    or (project_kind <> 'inbox' and inbox_owner_id is null)
  );

create unique index projects_single_workspace_materials_idx
  on public.projects (project_kind) where project_kind = 'workspace_materials';
create unique index projects_inbox_owner_idx
  on public.projects (inbox_owner_id) where project_kind = 'inbox';

do $$
declare
  materials_project_id uuid;
begin
  select id into materials_project_id from public.projects
  where project_kind = 'workspace_materials' limit 1;

  if materials_project_id is null then
    insert into public.projects (name, description, status, project_kind)
    values (
      '工作室材料',
      '工作室介绍、服务能力、案例、标准流程和材料模板。它与其他项目使用相同的资料与 Agent 工作方式。',
      'active',
      'workspace_materials'
    ) returning id into materials_project_id;
    insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage)
    values (materials_project_id, '工作室公共材料项目', '', '持续维护');
  end if;

  insert into public.project_members (project_id, user_id, role)
  select materials_project_id, profile.id, 'member'
  from public.profiles as profile
  where exists (select 1 from auth.users as account where account.id = profile.id)
  on conflict (project_id, user_id) do nothing;
end;
$$;

create function private.attach_profile_to_workspace_materials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  materials_project_id uuid;
begin
  select id into materials_project_id from public.projects
  where project_kind = 'workspace_materials' limit 1;
  if materials_project_id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (materials_project_id, new.id, 'member')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_attach_workspace_materials
after insert on public.profiles
for each row execute function private.attach_profile_to_workspace_materials();

alter table public.project_files
  add column archive_state text not null default 'archived'
    check (archive_state in ('archived', 'staged', 'unarchived')),
  add column inbox_owner_id uuid references auth.users (id) on delete cascade,
  add column inbox_source_project_id uuid references public.projects (id) on delete set null;

create index project_files_inbox_owner_state_idx
  on public.project_files (inbox_owner_id, archive_state, created_at desc)
  where archive_state in ('staged', 'unarchived');

create function public.get_or_create_unarchived_project()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  inbox_project_id uuid;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  select id into inbox_project_id from public.projects
  where project_kind = 'inbox' and inbox_owner_id = caller_id;
  if inbox_project_id is null then
    insert into public.projects (name, description, status, project_kind, inbox_owner_id)
    values ('未归档文件', '用户私有的待归档文件收件箱。', 'hidden', 'inbox', caller_id)
    returning id into inbox_project_id;
    insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage)
    values (inbox_project_id, '待用户选择归档项目', '', '待归档');
    insert into public.project_members (project_id, user_id, role)
    values (inbox_project_id, caller_id, 'project_lead')
    on conflict (project_id, user_id) do nothing;
  end if;
  return inbox_project_id;
end;
$$;

create function public.mark_project_file_staged(
  p_file_id uuid,
  p_source_project_id uuid
)
returns public.project_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.project_files%rowtype;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  select file.* into target
  from public.project_files as file
  join public.projects as project on project.id = file.project_id
  where file.id = p_file_id
    and file.uploaded_by = caller_id
    and project.project_kind = 'inbox'
    and project.inbox_owner_id = caller_id
  for update;
  if target.id is null then raise exception using errcode = 'P0002', message = 'Inbox file not found.'; end if;
  if not private.is_project_member(p_source_project_id) then
    raise exception using errcode = '42501', message = 'Source project access denied.';
  end if;
  update public.project_files
  set archive_state = 'staged', inbox_owner_id = caller_id, inbox_source_project_id = p_source_project_id
  where id = p_file_id
  returning * into target;
  return target;
end;
$$;

create function public.finalize_staged_files()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  changed integer;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  update public.project_files
  set archive_state = 'unarchived'
  where inbox_owner_id = caller_id and archive_state = 'staged';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.get_or_create_unarchived_project() from public, anon;
revoke all on function public.mark_project_file_staged(uuid, uuid) from public, anon;
revoke all on function public.finalize_staged_files() from public, anon;
grant execute on function public.get_or_create_unarchived_project() to authenticated;
grant execute on function public.mark_project_file_staged(uuid, uuid) to authenticated;
grant execute on function public.finalize_staged_files() to authenticated;

-- Project searches include the ordinary “工作室材料” project as shared
-- reference material. Hidden inbox files never enter normal project search.
create or replace function public.match_knowledge_chunks(
  p_project_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_scope text default 'all',
  p_match_count integer default 8
)
returns table (
  chunk_id uuid, document_id uuid, scope text, file_id uuid, file_name text,
  content text, page_number integer, section_title text,
  semantic_score double precision, keyword_score real, combined_score double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with workspace_materials as (
    select id from public.projects where project_kind = 'workspace_materials' limit 1
  ), ranked as (
    select
      chunk.id as chunk_id,
      chunk.document_id,
      chunk.scope,
      coalesce(document.project_file_id, document.company_file_id) as file_id,
      coalesce(project_file.file_name, company_file.file_name) as file_name,
      chunk.content,
      chunk.page_number,
      chunk.section_title,
      1 - (chunk.embedding OPERATOR(extensions.<=>) p_query_embedding) as semantic_score,
      greatest(
        ts_rank_cd(chunk.search_vector, websearch_to_tsquery('simple'::regconfig, p_query_text)),
        ts_rank_cd(
          to_tsvector('simple'::regconfig, coalesce(document.user_description, '') || ' ' || coalesce(document.agent_summary, '')),
          websearch_to_tsquery('simple'::regconfig, p_query_text)
        ),
        case when chunk.content ilike ('%' || p_query_text || '%') then 1::real else 0::real end,
        case when (document.user_description || ' ' || document.agent_summary) ilike ('%' || p_query_text || '%') then 1::real else 0::real end,
        extensions.similarity(chunk.content, p_query_text),
        extensions.similarity(document.user_description || ' ' || document.agent_summary, p_query_text)
      ) as keyword_score
    from public.knowledge_chunks as chunk
    join public.knowledge_documents as document on document.id = chunk.document_id
    left join public.project_files as project_file on project_file.id = document.project_file_id
    left join public.company_files as company_file on company_file.id = document.company_file_id
    where document.status = 'ready'
      and (
        (chunk.scope = 'project' and project_file.archive_state = 'archived' and (
          (chunk.project_id = p_project_id and p_scope in ('all', 'project'))
          or (chunk.project_id = (select id from workspace_materials) and p_scope in ('all', 'company'))
        ))
        or (chunk.scope = 'company' and p_scope in ('all', 'company'))
      )
  )
  select ranked.chunk_id, ranked.document_id, ranked.scope, ranked.file_id,
    ranked.file_name, ranked.content, ranked.page_number, ranked.section_title,
    ranked.semantic_score, ranked.keyword_score,
    (ranked.semantic_score * 0.75 + least(ranked.keyword_score, 1) * 0.25) as combined_score
  from ranked
  where ranked.semantic_score >= 0.18 or ranked.keyword_score > 0
  order by combined_score desc
  limit least(greatest(p_match_count, 1), 12);
$$;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/gif')
where id = 'project-files' and not ('image/gif' = any(allowed_mime_types));

comment on column public.projects.project_kind is 'standard, the shared 工作室材料 project, or a hidden per-user unarchived inbox.';
comment on column public.project_files.archive_state is 'staged remains attached to the current turn; unarchived appears in the user inbox; archived belongs to a visible project.';

commit;
