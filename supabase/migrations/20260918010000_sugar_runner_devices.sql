begin;

create table public.runner_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  platform text,
  app_version text,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index runner_devices_user_status_idx
  on public.runner_devices(user_id, status, last_seen_at desc);

create table public.runner_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index runner_pairing_codes_user_created_idx
  on public.runner_pairing_codes(user_id, created_at desc);

create table public.runner_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.runner_devices(id) on delete cascade,
  request_path text not null check (request_path in (
    '/v1/repositories/inspect',
    '/v1/repositories/diff',
    '/v1/repositories/action',
    '/v1/codex/discuss',
    '/v1/coding-runs/execute'
  )),
  request_body jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed', 'expired'
  )),
  response_body jsonb,
  response_status integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index runner_jobs_device_queue_idx
  on public.runner_jobs(device_id, status, created_at);
create index runner_jobs_user_created_idx
  on public.runner_jobs(user_id, created_at desc);

alter table public.runner_devices enable row level security;
alter table public.runner_pairing_codes enable row level security;
alter table public.runner_jobs enable row level security;

revoke all on public.runner_devices from anon, authenticated;
revoke all on public.runner_pairing_codes from anon, authenticated;
revoke all on public.runner_jobs from anon, authenticated;

create or replace function public.claim_runner_job(p_device_id uuid)
returns setof public.runner_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  update public.runner_jobs
  set status = 'expired', completed_at = now(), error_code = 'job_expired',
      error_message = 'Runner job expired before it was claimed.'
  where device_id = p_device_id
    and status = 'queued'
    and expires_at <= now();

  select id into claimed_id
  from public.runner_jobs
  where device_id = p_device_id
    and status = 'queued'
    and expires_at > now()
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.runner_jobs
  set status = 'running', claimed_at = now()
  where id = claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_runner_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_runner_job(uuid) to service_role;

create or replace function public.exchange_runner_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_name text,
  p_platform text,
  p_app_version text
)
returns setof public.runner_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.runner_pairing_codes%rowtype;
begin
  select * into pairing
  from public.runner_pairing_codes
  where code_hash = p_code_hash
    and used_at is null
    and expires_at > now()
  for update;

  if pairing.id is null then
    return;
  end if;

  update public.runner_pairing_codes set used_at = now() where id = pairing.id;
  return query
  insert into public.runner_devices(user_id, name, platform, app_version, token_hash, last_seen_at)
  values (pairing.user_id, p_name, p_platform, p_app_version, p_token_hash, now())
  returning *;
end;
$$;

revoke all on function public.exchange_runner_pairing_code(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.exchange_runner_pairing_code(text, text, text, text, text) to service_role;

comment on table public.runner_devices is
  'User-owned Sugar Runner installations. Only a one-way SHA-256 token hash is stored.';
comment on table public.runner_jobs is
  'Short-lived user-to-device jobs. OpenAI API keys are never stored in request_body.';

commit;
