begin;

alter table public.profiles
  add column model_onboarding_completed_at timestamptz;

-- Existing members have already used the workspace, so do not interrupt them
-- with the first-run setup page after this migration is deployed.
update public.profiles
set model_onboarding_completed_at = now()
where model_onboarding_completed_at is null;

-- Keep all existing studio members aligned with the new shared-project rule.
-- A user's private inbox is deliberately excluded.
insert into public.project_members (project_id, user_id, role)
select project.id, profile.id, 'member'
from public.projects as project
cross join public.profiles as profile
where project.project_kind <> 'inbox'
on conflict (project_id, user_id) do nothing;

drop trigger if exists profiles_attach_workspace_materials on public.profiles;
drop trigger if exists profiles_attach_all_projects on public.profiles;
drop function if exists private.attach_profile_to_workspace_materials();

create function private.attach_profile_to_all_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  select project.id, new.id, 'member'
  from public.projects as project
  where project.project_kind <> 'inbox'
  on conflict (project_id, user_id) do nothing;

  return new;
end;
$$;

revoke execute on function private.attach_profile_to_all_projects() from public, anon, authenticated;

create trigger profiles_attach_all_projects
after insert on public.profiles
for each row execute function private.attach_profile_to_all_projects();

comment on column public.profiles.model_onboarding_completed_at is
  'Set when a user configures a model or explicitly skips the first-run model setup.';

commit;
