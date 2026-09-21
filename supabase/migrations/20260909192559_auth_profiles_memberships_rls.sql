begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  constraint profiles_id_fkey
    foreign key (id)
    references auth.users (id)
    on delete cascade,
  constraint profiles_display_name_not_blank
    check (length(btrim(display_name)) > 0)
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint project_members_project_id_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete cascade,
  constraint project_members_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint project_members_role_check
    check (role in ('project_lead', 'member')),
  constraint project_members_project_id_user_id_key
    unique (project_id, user_id)
);

-- The first migration seeded three ownerless demo threads. Remove only those
-- known rows before making thread ownership mandatory. Their messages cascade.
delete from public.agent_threads
where id in (
  '7e71a61e-6804-4fb4-9f5e-0f80d6950201',
  '7e71a61e-6804-4fb4-9f5e-0f80d6950202',
  '7e71a61e-6804-4fb4-9f5e-0f80d6950203'
);

alter table public.agent_threads
  add column user_id uuid;

alter table public.agent_threads
  alter column user_id set not null,
  add constraint agent_threads_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade;

create index project_members_user_id_project_id_idx
  on public.project_members (user_id, project_id);

create index agent_threads_user_id_project_id_agent_type_idx
  on public.agent_threads (user_id, project_id, agent_type, updated_at desc);

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Sugar User'
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Backfill a profile if an Auth user already existed before this migration.
insert into public.profiles (id, display_name, avatar_url)
select
  users.id,
  coalesce(
    nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'Sugar User'
  ),
  nullif(users.raw_user_meta_data ->> 'avatar_url', '')
from auth.users as users
on conflict (id) do nothing;

create function private.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members as membership
    where membership.project_id = target_project_id
      and membership.user_id = (select auth.uid())
  );
$$;

create function private.shares_project_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members as mine
    join public.project_members as teammate
      on teammate.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and teammate.user_id = target_user_id
  );
$$;

create function private.can_access_thread(target_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_threads as thread
    join public.project_members as membership
      on membership.project_id = thread.project_id
     and membership.user_id = (select auth.uid())
    where thread.id = target_thread_id
      and thread.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_project_member(uuid) from public, anon;
revoke execute on function private.shares_project_with(uuid) from public, anon;
revoke execute on function private.can_access_thread(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_project_member(uuid) to authenticated;
grant execute on function private.shares_project_with(uuid) to authenticated;
grant execute on function private.can_access_thread(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.project_members enable row level security;

revoke all on table public.projects from anon, authenticated;
revoke all on table public.project_snapshots from anon, authenticated;
revoke all on table public.agent_threads from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
revoke all on table public.project_files from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.project_members from anon, authenticated;

grant select, update on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_snapshots to authenticated;
grant select, insert, update, delete on table public.agent_threads to authenticated;
grant select, insert, update, delete on table public.messages to authenticated;
grant select, insert, update, delete on table public.project_files to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.project_members to authenticated;

create policy projects_select_members
on public.projects
for select
to authenticated
using (private.is_project_member(id));

create policy projects_update_members
on public.projects
for update
to authenticated
using (private.is_project_member(id))
with check (private.is_project_member(id));

create policy project_members_select_members
on public.project_members
for select
to authenticated
using (private.is_project_member(project_id));

create policy project_members_insert_members
on public.project_members
for insert
to authenticated
with check (private.is_project_member(project_id));

create policy project_members_update_members
on public.project_members
for update
to authenticated
using (private.is_project_member(project_id))
with check (private.is_project_member(project_id));

create policy project_members_delete_members
on public.project_members
for delete
to authenticated
using (private.is_project_member(project_id));

create policy project_snapshots_select_members
on public.project_snapshots
for select
to authenticated
using (private.is_project_member(project_id));

create policy project_snapshots_insert_members
on public.project_snapshots
for insert
to authenticated
with check (private.is_project_member(project_id));

create policy project_snapshots_update_members
on public.project_snapshots
for update
to authenticated
using (private.is_project_member(project_id))
with check (private.is_project_member(project_id));

create policy project_snapshots_delete_members
on public.project_snapshots
for delete
to authenticated
using (private.is_project_member(project_id));

create policy project_files_select_members
on public.project_files
for select
to authenticated
using (private.is_project_member(project_id));

create policy project_files_insert_members
on public.project_files
for insert
to authenticated
with check (private.is_project_member(project_id));

create policy project_files_update_members
on public.project_files
for update
to authenticated
using (private.is_project_member(project_id))
with check (private.is_project_member(project_id));

create policy project_files_delete_members
on public.project_files
for delete
to authenticated
using (private.is_project_member(project_id));

create policy agent_threads_select_own
on public.agent_threads
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_project_member(project_id)
);

create policy agent_threads_insert_own
on public.agent_threads
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_project_member(project_id)
);

create policy agent_threads_update_own
on public.agent_threads
for update
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_project_member(project_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_project_member(project_id)
);

create policy agent_threads_delete_own
on public.agent_threads
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_project_member(project_id)
);

create policy messages_select_own_thread
on public.messages
for select
to authenticated
using (private.can_access_thread(thread_id));

create policy messages_insert_own_thread
on public.messages
for insert
to authenticated
with check (private.can_access_thread(thread_id));

create policy messages_update_own_thread
on public.messages
for update
to authenticated
using (private.can_access_thread(thread_id))
with check (private.can_access_thread(thread_id));

create policy messages_delete_own_thread
on public.messages
for delete
to authenticated
using (private.can_access_thread(thread_id));

create policy profiles_select_collaborators
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or private.shares_project_with(id)
);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

commit;
