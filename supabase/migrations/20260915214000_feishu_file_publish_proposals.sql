alter table public.feishu_knowledge_change_proposals
  drop constraint if exists feishu_knowledge_change_proposals_action_check,
  drop constraint if exists feishu_change_payload_matches_action;

alter table public.feishu_knowledge_change_proposals
  add column source_knowledge_document_id uuid
    references public.knowledge_documents(id) on delete restrict;

alter table public.feishu_knowledge_change_proposals
  add constraint feishu_knowledge_change_proposals_action_check
    check (action in ('create_document', 'append_content', 'replace_text', 'upload_file')),
  add constraint feishu_change_payload_matches_action check (
    (action = 'create_document' and target_document_id is null and source_knowledge_document_id is null and content is not null and old_text is null and new_text is null)
    or
    (action = 'append_content' and target_document_id is not null and source_knowledge_document_id is null and content is not null and old_text is null and new_text is null)
    or
    (action = 'replace_text' and target_document_id is not null and source_knowledge_document_id is null and content is null and old_text is not null and new_text is not null)
    or
    (action = 'upload_file' and target_document_id is null and source_knowledge_document_id is not null and content is null and old_text is null and new_text is null)
  );

create index feishu_change_proposals_source_document_idx
  on public.feishu_knowledge_change_proposals (source_knowledge_document_id, created_at desc)
  where source_knowledge_document_id is not null;

comment on column public.feishu_knowledge_change_proposals.source_knowledge_document_id
  is 'The original Supabase knowledge file to publish unchanged to Feishu for upload_file proposals.';
