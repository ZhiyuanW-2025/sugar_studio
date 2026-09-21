begin;

alter table public.company_files
  add column source_provider text not null default 'upload'
    check (source_provider in ('upload', 'feishu')),
  add column source_external_id text,
  add column source_url text,
  add column source_updated_at timestamptz;

create unique index company_files_active_external_source_key
  on public.company_files (source_provider, source_external_id)
  where source_external_id is not null and superseded_at is null;

create table public.feishu_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  space_id text not null check (length(btrim(space_id)) > 0),
  node_token text not null check (length(btrim(node_token)) > 0),
  parent_node_token text,
  obj_token text not null check (length(btrim(obj_token)) > 0),
  obj_type text not null check (obj_type in ('docx', 'doc', 'sheet', 'bitable', 'file', 'mindnote')),
  title text not null check (length(btrim(title)) > 0),
  source_url text,
  external_revision text,
  external_updated_at timestamptz,
  content_checksum text,
  company_file_id uuid unique references public.company_files(id) on delete set null,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'ready', 'failed', 'unsupported', 'removed')),
  sync_error text,
  last_seen_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, node_token),
  unique (space_id, obj_type, obj_token)
);

create index feishu_knowledge_documents_space_status_idx
  on public.feishu_knowledge_documents (space_id, sync_status, updated_at desc);
create index feishu_knowledge_documents_title_idx
  on public.feishu_knowledge_documents (lower(title));
create index feishu_knowledge_documents_obj_token_idx
  on public.feishu_knowledge_documents (obj_token);

create table public.feishu_knowledge_change_proposals (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_type text not null check (agent_type in ('planning', 'coding', 'design', 'client')),
  action text not null check (action in ('create_document', 'append_content', 'replace_text')),
  target_document_id uuid references public.feishu_knowledge_documents(id) on delete restrict,
  document_title text not null check (length(btrim(document_title)) > 0),
  change_summary text not null check (length(btrim(change_summary)) > 0),
  content text,
  old_text text,
  new_text text,
  expected_revision text,
  status text not null default 'pending'
    check (status in ('pending', 'applying', 'applied', 'cancelled', 'failed', 'conflict')),
  result_node_token text,
  result_url text,
  error_message text,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feishu_change_payload_matches_action check (
    (action = 'create_document' and target_document_id is null and content is not null and old_text is null and new_text is null)
    or
    (action = 'append_content' and target_document_id is not null and content is not null and old_text is null and new_text is null)
    or
    (action = 'replace_text' and target_document_id is not null and content is null and old_text is not null and new_text is not null)
  )
);

create index feishu_change_proposals_member_status_idx
  on public.feishu_knowledge_change_proposals (requested_by, status, created_at desc);
create index feishu_change_proposals_project_agent_idx
  on public.feishu_knowledge_change_proposals (project_id, agent_type, created_at desc);

create table public.feishu_sync_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique,
  event_type text not null,
  obj_token text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'ignored')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index feishu_sync_events_pending_idx
  on public.feishu_sync_events (created_at)
  where status = 'pending';

create trigger feishu_knowledge_documents_set_updated_at
before update on public.feishu_knowledge_documents
for each row execute function public.set_sugar_agent_updated_at();

create trigger feishu_knowledge_change_proposals_set_updated_at
before update on public.feishu_knowledge_change_proposals
for each row execute function public.set_sugar_agent_updated_at();

alter table public.feishu_knowledge_documents enable row level security;
alter table public.feishu_knowledge_change_proposals enable row level security;
alter table public.feishu_sync_events enable row level security;

create policy feishu_documents_select_workspace_members
on public.feishu_knowledge_documents for select to authenticated
using (private.is_workspace_member());

create policy feishu_change_proposals_select_workspace_members
on public.feishu_knowledge_change_proposals for select to authenticated
using (private.is_workspace_member());

create policy feishu_sync_events_select_workspace_members
on public.feishu_sync_events for select to authenticated
using (private.is_workspace_member());

revoke all on table public.feishu_knowledge_documents from anon, authenticated;
revoke all on table public.feishu_knowledge_change_proposals from anon, authenticated;
revoke all on table public.feishu_sync_events from anon, authenticated;
grant select on table public.feishu_knowledge_documents to authenticated;
grant select on table public.feishu_knowledge_change_proposals to authenticated;
grant select on table public.feishu_sync_events to authenticated;
grant select, insert, update, delete on table public.feishu_knowledge_documents to service_role;
grant select, insert, update, delete on table public.feishu_knowledge_change_proposals to service_role;
grant select, insert, update, delete on table public.feishu_sync_events to service_role;

comment on table public.feishu_knowledge_documents is
  'Server-managed mapping between Feishu Wiki nodes and Sugar Agent company knowledge files.';
comment on table public.feishu_knowledge_change_proposals is
  'Auditable member-initiated Agent proposals. Feishu writes run only after explicit confirmation.';
comment on table public.feishu_sync_events is
  'Deduplicated Feishu webhook events awaiting server-side mirror refresh.';
comment on column public.company_files.source_provider is
  'Origin of the company knowledge file. Feishu mirrors remain traceable to their source node.';

commit;
