begin;

revoke update on table public.knowledge_search_events from authenticated;
grant update (feedback) on table public.knowledge_search_events to authenticated;

create function private.restore_previous_project_file_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.replaces_file_id is not null and old.superseded_at is null then
    update public.project_files set superseded_at = null
    where id = old.replaces_file_id and project_id = old.project_id;
  end if;
  return old;
end;
$$;

create function private.restore_previous_company_file_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.replaces_file_id is not null and old.superseded_at is null then
    update public.company_files set superseded_at = null
    where id = old.replaces_file_id;
  end if;
  return old;
end;
$$;

create trigger project_files_restore_previous_version
before delete on public.project_files
for each row execute function private.restore_previous_project_file_version();

create trigger company_files_restore_previous_version
before delete on public.company_files
for each row execute function private.restore_previous_company_file_version();

revoke execute on function private.restore_previous_project_file_version() from public, anon, authenticated;
revoke execute on function private.restore_previous_company_file_version() from public, anon, authenticated;

commit;
