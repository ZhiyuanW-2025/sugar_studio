begin;

grant select, insert, update, delete on table public.company_files to service_role;
grant select, insert, update, delete on table public.knowledge_documents to service_role;
grant select, insert, update, delete on table public.knowledge_chunks to service_role;
grant select, insert, update, delete on table public.knowledge_ingestion_jobs to service_role;

commit;
