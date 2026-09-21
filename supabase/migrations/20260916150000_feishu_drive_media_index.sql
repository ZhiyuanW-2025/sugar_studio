begin;

create table public.feishu_drive_scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_token text not null check (length(btrim(folder_token)) > 0),
  source_url text not null check (length(btrim(source_url)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  enabled boolean not null default true,
  sync_frequency text not null default 'weekly' check (sync_frequency in ('manual', 'weekly')),
  last_sync_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_sync_status text not null default 'pending' check (last_sync_status in ('pending', 'syncing', 'ready', 'failed')),
  last_sync_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index feishu_drive_scopes_project_folder_key
  on public.feishu_drive_scopes (project_id, folder_token)
  where enabled;
create index feishu_drive_scopes_due_idx
  on public.feishu_drive_scopes (next_sync_at)
  where enabled and sync_frequency = 'weekly';

create table public.feishu_drive_items (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.feishu_drive_scopes(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  file_token text not null check (length(btrim(file_token)) > 0),
  parent_file_token text,
  item_type text not null check (item_type in ('folder', 'image', 'audio', 'video', 'other')),
  file_name text not null check (length(btrim(file_name)) > 0),
  file_extension text,
  source_url text,
  path_text text not null default '',
  source_created_at timestamptz,
  source_updated_at timestamptz,
  content_summary text not null default '',
  index_status text not null default 'pending' check (index_status in ('pending', 'processing', 'ready', 'metadata_only', 'failed')),
  index_error text,
  embedding extensions.vector(1536),
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(file_name, '') || ' ' || coalesce(path_text, '') || ' ' || coalesce(content_summary, ''))
  ) stored,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_id, file_token)
);

create index feishu_drive_items_project_type_idx
  on public.feishu_drive_items (project_id, item_type, updated_at desc);
create index feishu_drive_items_parent_idx
  on public.feishu_drive_items (scope_id, parent_file_token);
create index feishu_drive_items_search_idx
  on public.feishu_drive_items using gin (search_vector);
create index feishu_drive_items_embedding_idx
  on public.feishu_drive_items using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create trigger feishu_drive_scopes_set_updated_at
before update on public.feishu_drive_scopes
for each row execute function public.set_sugar_agent_updated_at();
create trigger feishu_drive_items_set_updated_at
before update on public.feishu_drive_items
for each row execute function public.set_sugar_agent_updated_at();

alter table public.feishu_drive_scopes enable row level security;
alter table public.feishu_drive_items enable row level security;

create policy feishu_drive_scopes_select_project_members
on public.feishu_drive_scopes for select to authenticated
using (private.is_project_member(project_id));

create policy feishu_drive_items_select_project_members
on public.feishu_drive_items for select to authenticated
using (private.is_project_member(project_id));

revoke all on table public.feishu_drive_scopes from anon, authenticated;
revoke all on table public.feishu_drive_items from anon, authenticated;
grant select on table public.feishu_drive_scopes to authenticated;
grant select on table public.feishu_drive_items to authenticated;
grant select, insert, update, delete on table public.feishu_drive_scopes to service_role;
grant select, insert, update, delete on table public.feishu_drive_items to service_role;

create function public.match_feishu_drive_items(
  p_project_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 8
)
returns table (
  item_id uuid,
  file_name text,
  item_type text,
  path_text text,
  content_summary text,
  source_url text,
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
      item.id as item_id,
      item.file_name,
      item.item_type,
      item.path_text,
      item.content_summary,
      item.source_url,
      case when item.embedding is null then 0::double precision
        else 1 - (item.embedding OPERATOR(extensions.<=>) p_query_embedding)
      end as semantic_score,
      greatest(
        ts_rank_cd(item.search_vector, websearch_to_tsquery('simple'::regconfig, p_query_text)),
        case when (item.file_name || ' ' || item.path_text || ' ' || item.content_summary) ilike ('%' || p_query_text || '%') then 1::real else 0::real end,
        extensions.similarity(item.file_name || ' ' || item.path_text || ' ' || item.content_summary, p_query_text)
      ) as keyword_score
    from public.feishu_drive_items item
    join public.feishu_drive_scopes scope on scope.id = item.scope_id
    where item.project_id = p_project_id
      and scope.enabled
      and item.index_status in ('ready', 'metadata_only')
  )
  select ranked.item_id, ranked.file_name, ranked.item_type, ranked.path_text,
    ranked.content_summary, ranked.source_url, ranked.semantic_score, ranked.keyword_score,
    (ranked.semantic_score * 0.7 + least(ranked.keyword_score, 1) * 0.3) as combined_score
  from ranked
  where ranked.semantic_score >= 0.18 or ranked.keyword_score > 0
  order by combined_score desc
  limit least(greatest(p_match_count, 1), 12);
$$;

revoke all on function public.match_feishu_drive_items(uuid, text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.match_feishu_drive_items(uuid, text, extensions.vector, integer) to service_role;

comment on table public.feishu_drive_scopes is 'Project-level Feishu Drive folder bindings for media assets.';
comment on table public.feishu_drive_items is 'Searchable metadata and AI summaries for Feishu Drive media. Original media bytes are never persisted here.';
comment on function public.match_feishu_drive_items(uuid, text, extensions.vector, integer) is 'Service-only hybrid search over project Feishu Drive media indexes.';

commit;
