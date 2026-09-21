begin;

create extension if not exists supabase_vault with schema vault;

create table public.user_model_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  model text not null,
  api_key_secret_id uuid not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_model_configs_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint user_model_configs_api_key_secret_id_fkey
    foreign key (api_key_secret_id)
    references vault.secrets (id)
    on delete restrict,
  constraint user_model_configs_provider_check
    check (provider in ('openai')),
  constraint user_model_configs_model_not_blank
    check (length(btrim(model)) > 0),
  constraint user_model_configs_user_provider_model_key
    unique (user_id, provider, model),
  constraint user_model_configs_api_key_secret_id_key
    unique (api_key_secret_id),
  constraint user_model_configs_id_user_id_key
    unique (id, user_id)
);

create unique index user_model_configs_one_default_per_user_idx
  on public.user_model_configs (user_id)
  where is_default;

create index user_model_configs_user_updated_at_idx
  on public.user_model_configs (user_id, updated_at desc);

create table public.agent_model_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_type text not null,
  model_config_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_model_preferences_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint agent_model_preferences_model_owner_fkey
    foreign key (model_config_id, user_id)
    references public.user_model_configs (id, user_id)
    on delete cascade,
  constraint agent_model_preferences_agent_type_check
    check (agent_type in ('planning', 'coding', 'design')),
  constraint agent_model_preferences_user_agent_type_key
    unique (user_id, agent_type)
);

create index agent_model_preferences_model_config_id_idx
  on public.agent_model_preferences (model_config_id);

create trigger user_model_configs_set_updated_at
before update on public.user_model_configs
for each row execute function public.set_sugar_agent_updated_at();

create trigger agent_model_preferences_set_updated_at
before update on public.agent_model_preferences
for each row execute function public.set_sugar_agent_updated_at();

alter table public.user_model_configs enable row level security;
alter table public.agent_model_preferences enable row level security;

revoke all on table public.user_model_configs from anon, authenticated;
revoke all on table public.agent_model_preferences from anon, authenticated;

-- Model config writes go through authenticated server routes so Vault cleanup
-- and default selection remain atomic. Authenticated users may directly read
-- only their own non-secret metadata.
grant select on table public.user_model_configs to authenticated;
grant select, insert, update, delete on table public.agent_model_preferences to authenticated;

create policy user_model_configs_select_own
on public.user_model_configs
for select
to authenticated
using (user_id = (select auth.uid()));

create policy user_model_configs_insert_own
on public.user_model_configs
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy user_model_configs_update_own
on public.user_model_configs
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy user_model_configs_delete_own
on public.user_model_configs
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy agent_model_preferences_select_own
on public.agent_model_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

create policy agent_model_preferences_insert_own
on public.agent_model_preferences
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy agent_model_preferences_update_own
on public.agent_model_preferences
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy agent_model_preferences_delete_own
on public.agent_model_preferences
for delete
to authenticated
using (user_id = (select auth.uid()));

create function public.create_user_model_config(
  p_user_id uuid,
  p_provider text,
  p_model text,
  p_api_key text,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config_id uuid := gen_random_uuid();
  v_secret_id uuid;
  v_is_default boolean;
begin
  if p_user_id is null then
    raise exception 'A user is required.' using errcode = '22023';
  end if;
  if p_provider <> 'openai' then
    raise exception 'Unsupported model provider.' using errcode = '22023';
  end if;
  if p_model is null or length(btrim(p_model)) = 0 then
    raise exception 'A model is required.' using errcode = '22023';
  end if;
  if p_api_key is null or length(btrim(p_api_key)) = 0 then
    raise exception 'An API key is required.' using errcode = '22023';
  end if;

  select p_is_default or not exists (
    select 1
    from public.user_model_configs as existing
    where existing.user_id = p_user_id
  )
  into v_is_default;

  if v_is_default then
    update public.user_model_configs
    set is_default = false
    where user_id = p_user_id
      and is_default;
  end if;

  select vault.create_secret(
    p_api_key,
    'sugar-model-' || p_user_id::text || '-' || v_config_id::text,
    'Sugar Agent model credential'
  )
  into v_secret_id;

  insert into public.user_model_configs (
    id,
    user_id,
    provider,
    model,
    api_key_secret_id,
    is_default
  )
  values (
    v_config_id,
    p_user_id,
    p_provider,
    btrim(p_model),
    v_secret_id,
    v_is_default
  );

  return v_config_id;
end;
$$;

create function public.update_user_model_config(
  p_user_id uuid,
  p_config_id uuid,
  p_provider text default null,
  p_model text default null,
  p_api_key text default null,
  p_is_default boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select config.api_key_secret_id
  into v_secret_id
  from public.user_model_configs as config
  where config.id = p_config_id
    and config.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Model configuration not found.' using errcode = '42501';
  end if;
  if p_provider is not null and p_provider <> 'openai' then
    raise exception 'Unsupported model provider.' using errcode = '22023';
  end if;
  if p_model is not null and length(btrim(p_model)) = 0 then
    raise exception 'A model cannot be blank.' using errcode = '22023';
  end if;
  if p_api_key is not null and length(btrim(p_api_key)) = 0 then
    raise exception 'An API key cannot be blank.' using errcode = '22023';
  end if;

  if p_is_default is true then
    update public.user_model_configs
    set is_default = false
    where user_id = p_user_id
      and id <> p_config_id
      and is_default;
  end if;

  if p_api_key is not null then
    perform vault.update_secret(v_secret_id, p_api_key);
  end if;

  update public.user_model_configs
  set
    provider = coalesce(p_provider, provider),
    model = coalesce(btrim(p_model), model),
    is_default = case when p_is_default is true then true else is_default end
  where id = p_config_id
    and user_id = p_user_id;
end;
$$;

create function public.delete_user_model_config(
  p_user_id uuid,
  p_config_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_was_default boolean;
begin
  select config.api_key_secret_id, config.is_default
  into v_secret_id, v_was_default
  from public.user_model_configs as config
  where config.id = p_config_id
    and config.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Model configuration not found.' using errcode = '42501';
  end if;

  delete from public.user_model_configs
  where id = p_config_id
    and user_id = p_user_id;

  delete from vault.secrets
  where id = v_secret_id;

  if v_was_default then
    update public.user_model_configs
    set is_default = true
    where id = (
      select remaining.id
      from public.user_model_configs as remaining
      where remaining.user_id = p_user_id
      order by remaining.updated_at desc, remaining.created_at desc, remaining.id
      limit 1
    );
  end if;
end;
$$;

create function public.list_user_model_configs(p_user_id uuid)
returns table (
  id uuid,
  provider text,
  model text,
  is_default boolean,
  api_key_masked text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    config.id,
    config.provider,
    config.model,
    config.is_default,
    case
      when length(secret.decrypted_secret) <= 4 then repeat('•', 8)
      else
        case
          when left(secret.decrypted_secret, 3) = 'sk-' then 'sk-'
          else ''
        end
        || repeat('•', 12)
        || right(secret.decrypted_secret, 4)
    end,
    config.created_at,
    config.updated_at
  from public.user_model_configs as config
  join vault.decrypted_secrets as secret
    on secret.id = config.api_key_secret_id
  where config.user_id = p_user_id
  order by config.is_default desc, config.updated_at desc, config.id;
$$;

create function public.resolve_user_model_config(
  p_user_id uuid,
  p_agent_type text
)
returns table (
  provider text,
  model text,
  api_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_agent_type not in ('planning', 'coding', 'design') then
    raise exception 'Unsupported agent type.' using errcode = '22023';
  end if;

  return query
  select
    config.provider,
    config.model,
    secret.decrypted_secret
  from public.user_model_configs as config
  join vault.decrypted_secrets as secret
    on secret.id = config.api_key_secret_id
  where config.user_id = p_user_id
    and config.id = coalesce(
      (
        select preference.model_config_id
        from public.agent_model_preferences as preference
        where preference.user_id = p_user_id
          and preference.agent_type = p_agent_type
      ),
      (
        select default_config.id
        from public.user_model_configs as default_config
        where default_config.user_id = p_user_id
          and default_config.is_default
        limit 1
      )
    )
  limit 1;
end;
$$;

revoke execute on function public.create_user_model_config(uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.update_user_model_config(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.delete_user_model_config(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.list_user_model_configs(uuid)
  from public, anon, authenticated;
revoke execute on function public.resolve_user_model_config(uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_user_model_config(uuid, text, text, text, boolean)
  to service_role;
grant execute on function public.update_user_model_config(uuid, uuid, text, text, text, boolean)
  to service_role;
grant execute on function public.delete_user_model_config(uuid, uuid)
  to service_role;
grant execute on function public.list_user_model_configs(uuid)
  to service_role;
grant execute on function public.resolve_user_model_config(uuid, text)
  to service_role;

comment on table public.user_model_configs is
  'Per-user model metadata. API key plaintext is stored only in Supabase Vault.';
comment on table public.agent_model_preferences is
  'Optional per-user, per-agent override of the user default model.';

commit;
