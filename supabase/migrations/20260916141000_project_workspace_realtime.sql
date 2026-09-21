begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_activities') then
      alter publication supabase_realtime add table public.project_activities;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_files') then
      alter publication supabase_realtime add table public.project_files;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'knowledge_documents') then
      alter publication supabase_realtime add table public.knowledge_documents;
    end if;
  end if;
end;
$$;

commit;
