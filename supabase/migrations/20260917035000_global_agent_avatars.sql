begin;

alter table public.agents
  add column avatar_url text;

alter table public.agent_config_activities
  drop constraint if exists agent_config_activities_event_type_check;

alter table public.agent_config_activities
  add constraint agent_config_activities_event_type_check
  check (event_type in (
    'agent_prompt_changed',
    'agent_prompt_rolled_back',
    'agent_avatar_changed',
    'agent_avatar_reset'
  ));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'agent-avatars',
  'agent-avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on column public.agents.avatar_url is
  'Workspace-global Agent avatar. All projects render the same current avatar.';

commit;
