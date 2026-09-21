grant select on table public.project_members to service_role;

comment on table public.project_members is
  'Project memberships. The service role has read-only access so scheduled knowledge sync can select an audit actor.';
