begin;

revoke select on table public.knowledge_chunks from authenticated;
grant select (
  id,
  document_id,
  scope,
  project_id,
  chunk_index,
  content,
  page_number,
  section_title,
  token_count,
  metadata,
  created_at
) on table public.knowledge_chunks to authenticated;

commit;
