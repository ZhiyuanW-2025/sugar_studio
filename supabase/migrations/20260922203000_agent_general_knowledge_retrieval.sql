begin;

create or replace function public.match_agent_general_knowledge_chunks(
  p_agent_type text,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
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
      document.company_file_id as file_id,
      company_file.file_name,
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
    from public.agents as agent
    join public.feishu_knowledge_documents as source
      on source.sync_scope_id = agent.general_feishu_scope_id
      and source.sync_status <> 'removed'
    join public.knowledge_documents as document
      on document.company_file_id = source.company_file_id
      and document.status = 'ready'
    join public.knowledge_chunks as chunk on chunk.document_id = document.id
    join public.company_files as company_file on company_file.id = document.company_file_id
    where agent.agent_type = p_agent_type
  )
  select
    ranked.chunk_id,
    ranked.document_id,
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

revoke all on function public.match_agent_general_knowledge_chunks(text, text, extensions.vector, integer)
  from public, anon, authenticated;
grant execute on function public.match_agent_general_knowledge_chunks(text, text, extensions.vector, integer)
  to service_role;

-- Agent-specific Feishu knowledge must not silently leak into the ordinary
-- company/project retrieval path. It is available only through the tool that
-- is bound to the current Agent type on the server.
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
  ), agent_files as (
    select distinct source.company_file_id
    from public.agents as agent
    join public.feishu_knowledge_documents as source
      on source.sync_scope_id = agent.general_feishu_scope_id
      and source.sync_status <> 'removed'
    where source.company_file_id is not null
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
        or (
          chunk.scope = 'company'
          and p_scope in ('all', 'company')
          and document.company_file_id not in (select company_file_id from agent_files)
        )
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

comment on function public.match_agent_general_knowledge_chunks(text, text, extensions.vector, integer)
  is 'Server-only hybrid retrieval restricted to the Feishu knowledge root connected to one global Agent.';

commit;
