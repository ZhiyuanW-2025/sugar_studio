begin;

create table public.image_model_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  credential_config_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_model_preferences_provider_check check (provider in ('openai')),
  constraint image_model_preferences_model_not_blank check (length(btrim(model)) > 0),
  constraint image_model_preferences_user_key unique (user_id),
  constraint image_model_preferences_credential_owner_fkey
    foreign key (credential_config_id, user_id)
    references public.user_model_configs (id, user_id)
    on delete cascade
);

create index image_model_preferences_credential_idx
  on public.image_model_preferences (credential_config_id);

create trigger image_model_preferences_set_updated_at
before update on public.image_model_preferences
for each row execute function public.set_sugar_agent_updated_at();

alter table public.image_model_preferences enable row level security;
revoke all on table public.image_model_preferences from anon, authenticated;
grant select, insert, update, delete on table public.image_model_preferences to authenticated;

create policy image_model_preferences_select_own
on public.image_model_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy image_model_preferences_insert_own
on public.image_model_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy image_model_preferences_update_own
on public.image_model_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy image_model_preferences_delete_own
on public.image_model_preferences for delete to authenticated
using (user_id = (select auth.uid()));

create table public.image_generations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  thread_id uuid references public.agent_threads (id) on delete set null,
  handoff_task_id uuid references public.handoff_tasks (id) on delete set null,
  provider text not null,
  model text not null,
  prompt text not null,
  brief jsonb,
  size text not null default '1024x1024',
  quality text not null default 'medium',
  output_format text not null default 'png',
  status text not null default 'running',
  storage_path text unique,
  mime_type text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint image_generations_provider_check check (provider in ('openai')),
  constraint image_generations_prompt_not_blank check (length(btrim(prompt)) > 0),
  constraint image_generations_size_check check (size in ('1024x1024', '1536x1024', '1024x1536')),
  constraint image_generations_quality_check check (quality in ('low', 'medium', 'high', 'xhigh', 'auto')),
  constraint image_generations_format_check check (output_format in ('png', 'jpeg', 'webp')),
  constraint image_generations_status_check check (status in ('running', 'completed', 'failed')),
  constraint image_generations_completion_check check (
    (status = 'completed' and storage_path is not null and mime_type is not null and completed_at is not null)
    or (status = 'failed' and error_message is not null)
    or status = 'running'
  ),
  constraint image_generations_user_request_key unique (user_id, request_id)
);

create index image_generations_project_created_idx
  on public.image_generations (project_id, created_at desc);
create index image_generations_user_project_created_idx
  on public.image_generations (user_id, project_id, created_at desc);
create index image_generations_status_idx
  on public.image_generations (status, created_at desc);

create trigger image_generations_set_updated_at
before update on public.image_generations
for each row execute function public.set_sugar_agent_updated_at();

alter table public.image_generations enable row level security;
revoke all on table public.image_generations from anon, authenticated;
grant select on table public.image_generations to authenticated;

create policy image_generations_select_members
on public.image_generations for select to authenticated
using (private.is_project_member(project_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-images',
  'agent-images',
  false,
  26214400,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy agent_images_storage_select_members
on storage.objects for select to authenticated
using (
  bucket_id = 'agent-images'
  and private.is_project_member(private.project_id_from_storage_path(name))
);

create function public.resolve_user_image_model_config(p_user_id uuid)
returns table (
  provider text,
  model text,
  credential_config_id uuid,
  api_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(preference.provider, config.provider),
    coalesce(preference.model, 'gpt-image-2.5-flare'),
    config.id,
    secret.decrypted_secret
  from public.user_model_configs as config
  join vault.decrypted_secrets as secret
    on secret.id = config.api_key_secret_id
  left join public.image_model_preferences as preference
    on preference.user_id = p_user_id
   and preference.credential_config_id = config.id
  where config.user_id = p_user_id
    and config.provider = 'openai'
    and config.id = coalesce(
      (
        select selected.credential_config_id
        from public.image_model_preferences as selected
        where selected.user_id = p_user_id
      ),
      (
        select fallback.id
        from public.user_model_configs as fallback
        where fallback.user_id = p_user_id
          and fallback.provider = 'openai'
          and fallback.is_default
        limit 1
      )
    )
  limit 1;
$$;

revoke execute on function public.resolve_user_image_model_config(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_user_image_model_config(uuid)
  to service_role;

comment on table public.image_model_preferences is
  'Per-user image model choice. The referenced model config supplies a Vault-backed OpenAI credential.';
comment on table public.image_generations is
  'Auditable server-created image generation jobs and their private Storage outputs.';
comment on function public.resolve_user_image_model_config(uuid) is
  'Service-role-only resolution of the effective image model and decrypted Vault credential.';

commit;
