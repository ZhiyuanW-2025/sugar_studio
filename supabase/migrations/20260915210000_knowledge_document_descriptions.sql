alter table public.knowledge_documents
  add column if not exists user_description text not null default '',
  add column if not exists agent_summary text not null default '',
  add column if not exists description_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists description_updated_at timestamptz;

alter table public.knowledge_documents
  add constraint knowledge_documents_user_description_length
    check (char_length(user_description) <= 8000),
  add constraint knowledge_documents_agent_summary_length
    check (char_length(agent_summary) <= 8000);

create index if not exists knowledge_documents_description_search_idx
  on public.knowledge_documents using gin (
    to_tsvector('simple'::regconfig, coalesce(user_description, '') || ' ' || coalesce(agent_summary, ''))
  );

create or replace function public.update_knowledge_document_descriptions(
  p_document_id uuid,
  p_user_description text default null,
  p_agent_summary text default null
)
returns public.knowledge_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.knowledge_documents%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select * into target from public.knowledge_documents where id = p_document_id for update;
  if target.id is null then
    raise exception using errcode = 'P0002', message = 'Knowledge document not found.';
  end if;

  if target.scope = 'project' and not private.is_project_member(target.project_id) then
    raise exception using errcode = '42501', message = 'Project membership required.';
  end if;
  if target.scope = 'company' and not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace membership required.';
  end if;
  if p_user_description is not null and char_length(p_user_description) > 8000 then
    raise exception using errcode = '22001', message = 'User description is too long.';
  end if;
  if p_agent_summary is not null and char_length(p_agent_summary) > 8000 then
    raise exception using errcode = '22001', message = 'Agent summary is too long.';
  end if;

  update public.knowledge_documents
  set user_description = case when p_user_description is null then user_description else btrim(p_user_description) end,
      agent_summary = case when p_agent_summary is null then agent_summary else btrim(p_agent_summary) end,
      description_updated_by = caller_id,
      description_updated_at = now()
  where id = p_document_id
  returning * into target;
  return target;
end;
$$;

revoke all on function public.update_knowledge_document_descriptions(uuid, text, text) from public, anon;
grant execute on function public.update_knowledge_document_descriptions(uuid, text, text) to authenticated;

create or replace function public.match_knowledge_chunks(
  p_project_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_scope text default 'all',
  p_match_count integer default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  scope text,
  file_id uuid,
  file_name text,
  content text,
  page_number integer,
  section_title text,
  semantic_score double precision,
  keyword_score real,
  combined_score double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
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
        (chunk.scope = 'project' and chunk.project_id = p_project_id and p_scope in ('all', 'project'))
        or (chunk.scope = 'company' and p_scope in ('all', 'company'))
      )
  )
  select
    ranked.chunk_id,
    ranked.document_id,
    ranked.scope,
    ranked.file_id,
    ranked.file_name,
    ranked.content,
    ranked.page_number,
    ranked.section_title,
    ranked.semantic_score,
    ranked.keyword_score,
    (ranked.semantic_score * 0.75 + least(ranked.keyword_score, 1) * 0.25) as combined_score
  from ranked
  where ranked.semantic_score >= 0.18 or ranked.keyword_score > 0
  order by combined_score desc
  limit least(greatest(p_match_count, 1), 12);
$$;

comment on column public.knowledge_documents.user_description
  is 'The user original explanation of what this source is and how it should be used.';
comment on column public.knowledge_documents.agent_summary
  is 'An agent-authored summary of the source purpose, key points and usage limits.';
comment on function public.update_knowledge_document_descriptions(uuid, text, text)
  is 'Safely updates permanent knowledge metadata after membership checks.';
