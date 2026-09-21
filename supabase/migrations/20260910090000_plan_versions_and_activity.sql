begin;

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  artifact_type text not null,
  title text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifacts_type_not_blank check (length(btrim(artifact_type)) > 0),
  constraint artifacts_title_not_blank check (length(btrim(title)) > 0),
  constraint artifacts_project_type_key unique (project_id, artifact_type)
);

create table public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  version integer not null,
  content text not null,
  change_summary text not null,
  created_by uuid references auth.users (id) on delete set null,
  source_thread_id uuid references public.agent_threads (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint artifact_versions_version_positive check (version > 0),
  constraint artifact_versions_content_not_blank check (length(btrim(content)) > 0),
  constraint artifact_versions_change_not_blank check (length(btrim(change_summary)) > 0),
  constraint artifact_versions_artifact_version_key unique (artifact_id, version)
);

alter table public.artifacts
  add constraint artifacts_current_version_id_fkey
  foreign key (current_version_id)
  references public.artifact_versions (id)
  on delete set null;

alter table public.project_snapshots
  add column current_plan_version_id uuid
  references public.artifact_versions (id)
  on delete set null;

create table public.project_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  actor_type text not null,
  actor text not null,
  summary text not null,
  related_entity_id uuid,
  created_at timestamptz not null default now(),
  constraint project_activities_event_not_blank check (length(btrim(event_type)) > 0),
  constraint project_activities_actor_type_check check (actor_type in ('user', 'agent')),
  constraint project_activities_actor_not_blank check (length(btrim(actor)) > 0),
  constraint project_activities_summary_not_blank check (length(btrim(summary)) > 0)
);

create index artifacts_project_id_updated_at_idx
  on public.artifacts (project_id, updated_at desc);

create index artifact_versions_artifact_id_created_at_idx
  on public.artifact_versions (artifact_id, created_at desc);

create index artifact_versions_created_by_idx
  on public.artifact_versions (created_by, created_at desc);

create index project_activities_project_id_created_at_idx
  on public.project_activities (project_id, created_at desc);

create index project_activities_event_type_idx
  on public.project_activities (project_id, event_type, created_at desc);

create trigger artifacts_set_updated_at
before update on public.artifacts
for each row execute function public.set_sugar_agent_updated_at();

alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.project_activities enable row level security;

revoke all on table public.artifacts from anon, authenticated;
revoke all on table public.artifact_versions from anon, authenticated;
revoke all on table public.project_activities from anon, authenticated;

grant select on table public.artifacts to authenticated;
grant select on table public.artifact_versions to authenticated;
grant select on table public.project_activities to authenticated;

create policy artifacts_select_members
on public.artifacts
for select
to authenticated
using (private.is_project_member(project_id));

create policy artifact_versions_select_members
on public.artifact_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.artifacts as artifact
    where artifact.id = artifact_versions.artifact_id
      and private.is_project_member(artifact.project_id)
  )
);

create policy project_activities_select_members
on public.project_activities
for select
to authenticated
using (private.is_project_member(project_id));

create function public.save_current_plan(
  p_project_id uuid,
  p_source_thread_id uuid,
  p_content text,
  p_change_summary text
)
returns table (
  artifact_id uuid,
  version_id uuid,
  version integer,
  current_plan_summary text,
  change_summary text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_artifact_id uuid;
  v_version_id uuid;
  v_version integer;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if nullif(btrim(p_content), '') is null
     or nullif(btrim(p_change_summary), '') is null then
    raise exception using errcode = '23514', message = 'Plan content and change summary are required.';
  end if;

  if not exists (
    select 1
    from public.project_members as membership
    where membership.project_id = p_project_id
      and membership.user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  if not exists (
    select 1
    from public.agent_threads as thread
    where thread.id = p_source_thread_id
      and thread.project_id = p_project_id
      and thread.user_id = caller_id
      and thread.agent_type = 'planning'
  ) then
    raise exception using errcode = '42501', message = 'Planning source thread access denied.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':planning_plan', 0));

  insert into public.artifacts (project_id, artifact_type, title)
  values (p_project_id, 'planning_plan', '当前策划方案')
  on conflict (project_id, artifact_type)
  do update set updated_at = now()
  returning id into v_artifact_id;

  select coalesce(max(existing.version), 0) + 1
  into v_version
  from public.artifact_versions as existing
  where existing.artifact_id = v_artifact_id;

  insert into public.artifact_versions (
    artifact_id,
    version,
    content,
    change_summary,
    created_by,
    source_thread_id
  )
  values (
    v_artifact_id,
    v_version,
    btrim(p_content),
    btrim(p_change_summary),
    caller_id,
    p_source_thread_id
  )
  returning id into v_version_id;

  update public.artifacts
  set current_version_id = v_version_id,
      updated_at = now()
  where id = v_artifact_id;

  insert into public.project_snapshots (
    project_id,
    current_plan_summary,
    current_plan_version_id
  )
  values (
    p_project_id,
    btrim(p_content),
    v_version_id
  )
  on conflict (project_id)
  do update set
    current_plan_summary = excluded.current_plan_summary,
    current_plan_version_id = excluded.current_plan_version_id,
    updated_at = now();

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into v_actor
  from public.profiles as profile
  where profile.id = caller_id;

  insert into public.project_activities (
    project_id,
    user_id,
    event_type,
    actor_type,
    actor,
    summary,
    related_entity_id
  )
  values (
    p_project_id,
    caller_id,
    'plan_version_saved',
    'user',
    coalesce(v_actor, '项目成员'),
    format('保存了正式策划方案 v%s：%s', v_version, btrim(p_change_summary)),
    v_version_id
  );

  return query
  select
    v_artifact_id,
    v_version_id,
    v_version,
    btrim(p_content),
    btrim(p_change_summary);
end;
$$;

revoke all on function public.save_current_plan(uuid, uuid, text, text) from public, anon;
grant execute on function public.save_current_plan(uuid, uuid, text, text) to authenticated;

comment on table public.artifacts is 'Stable project deliverables whose immutable content lives in artifact_versions.';
comment on table public.artifact_versions is 'Immutable user-confirmed versions of a project artifact.';
comment on table public.project_activities is 'Low-frequency project audit timeline visible to project members.';
comment on function public.save_current_plan(uuid, uuid, text, text)
  is 'Atomically creates a planning version, advances the project snapshot, and records activity after user confirmation.';

commit;
