begin;

alter table public.profiles add column updated_at timestamptz not null default now();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_sugar_agent_updated_at();

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check (length(btrim(email)) between 3 and 320),
  role text not null default 'member' check (role in ('project_lead','member')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references auth.users(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index project_invitations_pending_email_key on public.project_invitations(project_id,lower(email)) where status='pending';
create index project_invitations_project_created_idx on public.project_invitations(project_id,created_at desc);
create trigger project_invitations_set_updated_at before update on public.project_invitations for each row execute function public.set_sugar_agent_updated_at();

create table public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('profile_updated','avatar_updated','password_changed','password_reset_requested','project_invitation_sent','signed_out_all_devices')),
  summary text not null check (length(btrim(summary)) > 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index account_security_events_user_created_idx on public.account_security_events(user_id,created_at desc);

alter table public.project_invitations enable row level security;
alter table public.account_security_events enable row level security;
revoke all on table public.project_invitations,public.account_security_events from anon,authenticated;
grant select on table public.project_invitations,public.account_security_events to authenticated;
grant select,insert,update,delete on table public.project_invitations,public.account_security_events to service_role;
create policy project_invitations_select_members on public.project_invitations for select to authenticated using(private.is_project_member(project_id));
create policy account_security_events_select_own on public.account_security_events for select to authenticated using(user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('profile-avatars','profile-avatars',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy profile_avatars_insert_own on storage.objects for insert to authenticated with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_avatars_update_own on storage.objects for update to authenticated using(bucket_id='profile-avatars' and owner_id=(select auth.uid())::text) with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_avatars_delete_own on storage.objects for delete to authenticated using(bucket_id='profile-avatars' and owner_id=(select auth.uid())::text);

comment on table public.project_invitations is 'Audited project invitations; project roles remain labels with equal project access.';
comment on table public.account_security_events is 'User-visible security history without secrets, request headers, or credential content.';
commit;
