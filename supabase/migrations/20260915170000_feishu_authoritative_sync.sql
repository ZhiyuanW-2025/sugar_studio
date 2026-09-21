begin;

create table public.feishu_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null default '飞书企业知识库' check (length(btrim(name)) > 0),
  tenant_url text,
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  last_error text,
  validated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index feishu_connections_tenant_url_key
  on public.feishu_connections (lower(tenant_url))
  where tenant_url is not null and status <> 'disabled';

create table public.feishu_sync_scopes (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.feishu_connections(id) on delete cascade,
  scope_type text not null check (scope_type in ('company', 'project')),
  project_id uuid references public.projects(id) on delete cascade,
  space_id text not null check (length(btrim(space_id)) > 0),
  root_node_token text,
  source_url text not null check (length(btrim(source_url)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  enabled boolean not null default true,
  sync_frequency text not null default 'weekly' check (sync_frequency in ('manual', 'weekly')),
  sync_weekday smallint not null default 1 check (sync_weekday between 0 and 6),
  sync_hour_utc smallint not null default 4 check (sync_hour_utc between 0 and 23),
  last_incremental_sync_at timestamptz,
  last_full_sync_at timestamptz,
  next_full_sync_at timestamptz not null default now(),
  last_sync_status text not null default 'pending'
    check (last_sync_status in ('pending', 'syncing', 'ready', 'failed')),
  last_sync_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feishu_sync_scopes_project_matches_type check (
    (scope_type = 'company' and project_id is null)
    or (scope_type = 'project' and project_id is not null)
  )
);

create unique index feishu_sync_scopes_unique_source
  on public.feishu_sync_scopes (
    connection_id,
    space_id,
    coalesce(root_node_token, ''),
    scope_type,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where enabled;
create index feishu_sync_scopes_due_idx
  on public.feishu_sync_scopes (next_full_sync_at)
  where enabled and sync_frequency = 'weekly';
create index feishu_sync_scopes_project_idx
  on public.feishu_sync_scopes (project_id, updated_at desc)
  where scope_type = 'project';

alter table public.project_files
  add column source_provider text not null default 'upload'
    check (source_provider in ('upload', 'feishu')),
  add column source_external_id text,
  add column source_url text,
  add column source_updated_at timestamptz;

create unique index project_files_active_external_source_key
  on public.project_files (project_id, source_provider, source_external_id)
  where source_external_id is not null and superseded_at is null;

alter table public.feishu_knowledge_documents
  add column sync_scope_id uuid references public.feishu_sync_scopes(id) on delete cascade,
  add column scope_type text check (scope_type in ('company', 'project')),
  add column project_id uuid references public.projects(id) on delete cascade,
  add column project_file_id uuid unique references public.project_files(id) on delete set null;

alter table public.feishu_knowledge_documents
  drop constraint if exists feishu_knowledge_documents_space_id_node_token_key,
  drop constraint if exists feishu_knowledge_documents_space_id_obj_type_obj_token_key;

insert into public.feishu_connections (name, status)
select format('旧飞书知识空间 %s', source.space_id), 'active'
from (select distinct space_id from public.feishu_knowledge_documents) source;

insert into public.feishu_sync_scopes (
  connection_id, scope_type, space_id, source_url, display_name,
  sync_frequency, next_full_sync_at, last_sync_status
)
select connection.id, 'company', document.space_id,
  format('https://open.feishu.cn/wiki/settings/%s', document.space_id),
  '飞书企业知识库', 'weekly', now(), 'ready'
from (select distinct space_id from public.feishu_knowledge_documents) document
join public.feishu_connections connection
  on connection.name = format('旧飞书知识空间 %s', document.space_id);

update public.feishu_knowledge_documents document
set sync_scope_id = scope.id,
    scope_type = 'company'
from public.feishu_sync_scopes scope
where scope.scope_type = 'company'
  and scope.space_id = document.space_id
  and document.sync_scope_id is null;

create unique index feishu_documents_scope_node_key
  on public.feishu_knowledge_documents (sync_scope_id, node_token)
  where sync_scope_id is not null;
create unique index feishu_documents_scope_object_key
  on public.feishu_knowledge_documents (sync_scope_id, obj_type, obj_token)
  where sync_scope_id is not null;
create index feishu_documents_project_status_idx
  on public.feishu_knowledge_documents (project_id, sync_status, updated_at desc)
  where scope_type = 'project';

alter table public.feishu_knowledge_change_proposals
  add column sync_scope_id uuid references public.feishu_sync_scopes(id) on delete restrict,
  add column base_revision_id uuid;

create table public.feishu_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.feishu_knowledge_documents(id) on delete cascade,
  external_revision text not null,
  content_checksum text not null check (content_checksum ~ '^[0-9a-f]{64}$'),
  raw_content text not null,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  source text not null check (source in ('sync', 'pre_write', 'post_write')),
  created_at timestamptz not null default now(),
  unique (document_id, external_revision, content_checksum)
);

create index feishu_document_revisions_document_created_idx
  on public.feishu_document_revisions (document_id, created_at desc);

alter table public.feishu_knowledge_change_proposals
  add constraint feishu_change_proposals_base_revision_fkey
    foreign key (base_revision_id) references public.feishu_document_revisions(id) on delete set null;

create table public.feishu_merge_conflicts (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.feishu_knowledge_change_proposals(id) on delete cascade,
  document_id uuid not null references public.feishu_knowledge_documents(id) on delete cascade,
  base_revision text not null,
  live_revision text not null,
  base_blocks jsonb not null check (jsonb_typeof(base_blocks) = 'array'),
  live_blocks jsonb not null check (jsonb_typeof(live_blocks) = 'array'),
  proposed_change jsonb not null check (jsonb_typeof(proposed_change) = 'object'),
  conflicting_block_ids text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'resolved', 'cancelled')),
  resolution text check (resolution is null or resolution in ('agent', 'feishu', 'custom')),
  resolved_content text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feishu_merge_conflicts_status_created_idx
  on public.feishu_merge_conflicts (status, created_at desc);

create trigger feishu_connections_set_updated_at
before update on public.feishu_connections
for each row execute function public.set_sugar_agent_updated_at();
create trigger feishu_sync_scopes_set_updated_at
before update on public.feishu_sync_scopes
for each row execute function public.set_sugar_agent_updated_at();
create trigger feishu_merge_conflicts_set_updated_at
before update on public.feishu_merge_conflicts
for each row execute function public.set_sugar_agent_updated_at();

alter table public.feishu_connections enable row level security;
alter table public.feishu_sync_scopes enable row level security;
alter table public.feishu_document_revisions enable row level security;
alter table public.feishu_merge_conflicts enable row level security;

create policy feishu_connections_select_workspace_members
on public.feishu_connections for select to authenticated
using (private.is_workspace_member());

create policy feishu_sync_scopes_select_allowed_members
on public.feishu_sync_scopes for select to authenticated
using (
  (scope_type = 'company' and private.is_workspace_member())
  or (scope_type = 'project' and private.is_project_member(project_id))
);

create policy feishu_revisions_select_allowed_members
on public.feishu_document_revisions for select to authenticated
using (exists (
  select 1
  from public.feishu_knowledge_documents document
  join public.feishu_sync_scopes scope on scope.id = document.sync_scope_id
  where document.id = feishu_document_revisions.document_id
    and (
      (scope.scope_type = 'company' and private.is_workspace_member())
      or (scope.scope_type = 'project' and private.is_project_member(scope.project_id))
    )
));

create policy feishu_conflicts_select_allowed_members
on public.feishu_merge_conflicts for select to authenticated
using (exists (
  select 1
  from public.feishu_knowledge_documents document
  join public.feishu_sync_scopes scope on scope.id = document.sync_scope_id
  where document.id = feishu_merge_conflicts.document_id
    and (
      (scope.scope_type = 'company' and private.is_workspace_member())
      or (scope.scope_type = 'project' and private.is_project_member(scope.project_id))
    )
));

revoke all on table public.feishu_connections from anon, authenticated;
revoke all on table public.feishu_sync_scopes from anon, authenticated;
revoke all on table public.feishu_document_revisions from anon, authenticated;
revoke all on table public.feishu_merge_conflicts from anon, authenticated;
grant select on table public.feishu_connections to authenticated;
grant select on table public.feishu_sync_scopes to authenticated;
grant select on table public.feishu_document_revisions to authenticated;
grant select on table public.feishu_merge_conflicts to authenticated;
grant select, insert, update, delete on table public.feishu_connections to service_role;
grant select, insert, update, delete on table public.feishu_sync_scopes to service_role;
grant select, insert, update, delete on table public.feishu_document_revisions to service_role;
grant select, insert, update, delete on table public.feishu_merge_conflicts to service_role;

comment on table public.feishu_connections is
  'Workspace Feishu tenant metadata. Application credentials remain server-only and are never stored here.';
comment on table public.feishu_sync_scopes is
  'User-configured Feishu Wiki roots mapped to company or project knowledge mirrors.';
comment on table public.feishu_document_revisions is
  'Immutable source snapshots used for read-after-write verification and three-way merge.';
comment on table public.feishu_merge_conflicts is
  'Human-resolved conflicts where the same Feishu block changed after an Agent proposal was created.';

commit;
