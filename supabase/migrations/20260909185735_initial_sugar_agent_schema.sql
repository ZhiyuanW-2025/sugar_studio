begin;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint projects_status_not_blank check (length(btrim(status)) > 0)
);

create table public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  summary text not null default '',
  current_plan_summary text not null default '',
  current_stage text not null default '',
  updated_at timestamptz not null default now(),
  constraint project_snapshots_project_id_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete cascade,
  constraint project_snapshots_project_id_key unique (project_id)
);

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  agent_type text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_threads_project_id_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete cascade,
  constraint agent_threads_agent_type_check
    check (agent_type in ('planning', 'coding', 'design')),
  constraint agent_threads_title_not_blank check (length(btrim(title)) > 0)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint messages_thread_id_fkey
    foreign key (thread_id)
    references public.agent_threads (id)
    on delete cascade,
  constraint messages_role_check
    check (role in ('user', 'assistant', 'system')),
  constraint messages_content_not_blank check (length(btrim(content)) > 0)
);

create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_type text not null,
  created_at timestamptz not null default now(),
  constraint project_files_project_id_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete cascade,
  constraint project_files_file_name_not_blank check (length(btrim(file_name)) > 0),
  constraint project_files_storage_path_not_blank check (length(btrim(storage_path)) > 0),
  constraint project_files_file_type_not_blank check (length(btrim(file_type)) > 0)
);

create index projects_status_updated_at_idx
  on public.projects (status, updated_at desc);

create index agent_threads_project_id_updated_at_idx
  on public.agent_threads (project_id, updated_at desc);

create index agent_threads_project_id_agent_type_idx
  on public.agent_threads (project_id, agent_type);

create index messages_thread_id_created_at_idx
  on public.messages (thread_id, created_at, id);

create index project_files_project_id_created_at_idx
  on public.project_files (project_id, created_at desc);

create unique index project_files_storage_path_key
  on public.project_files (storage_path);

create function public.set_sugar_agent_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_sugar_agent_updated_at();

create trigger project_snapshots_set_updated_at
before update on public.project_snapshots
for each row execute function public.set_sugar_agent_updated_at();

create trigger agent_threads_set_updated_at
before update on public.agent_threads
for each row execute function public.set_sugar_agent_updated_at();

alter table public.projects enable row level security;
alter table public.project_snapshots enable row level security;
alter table public.agent_threads enable row level security;
alter table public.messages enable row level security;
alter table public.project_files enable row level security;

comment on table public.projects is 'Sugar Agent projects.';
comment on table public.project_snapshots is 'The single current knowledge snapshot for each project.';
comment on table public.agent_threads is 'Per-project conversations with specialist agents.';
comment on table public.messages is 'Messages belonging to an agent thread.';
comment on table public.project_files is 'Metadata for files associated with a project.';

commit;
