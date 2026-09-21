-- Run with: npx supabase db query --linked --file supabase/tests/model_configs_rls.sql
-- All fixtures and Vault secrets are rolled back at the end.

begin;

create function private.assert_count(check_name text, actual_count bigint, expected_count bigint)
returns void
language plpgsql
as $$
begin
  if actual_count <> expected_count then
    raise exception '%: expected %, got %', check_name, expected_count, actual_count;
  end if;
end;
$$;

create function private.assert_text(check_name text, actual_value text, expected_value text)
returns void
language plpgsql
as $$
begin
  if actual_value is distinct from expected_value then
    raise exception '%: expected %, got %', check_name, expected_value, actual_value;
  end if;
end;
$$;

create function private.test_config_id(target_user_id uuid, target_model text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.user_model_configs
  where user_id = target_user_id
    and model = target_model;
$$;

grant execute on function private.assert_count(text, bigint, bigint) to authenticated, service_role;
grant execute on function private.assert_text(text, text, text) to authenticated, service_role;
grant execute on function private.test_config_id(uuid, text) to authenticated;
grant usage on schema private to service_role;
grant select on table public.user_model_configs to service_role;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('71000000-0000-4000-8000-000000000001', 'model-a@sugar.invalid', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'model-b@sugar.invalid', '{}', now(), now());

set local role service_role;

select public.create_user_model_config(
  '71000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-test-default',
  'sk-test-a-default-ABCD',
  true
);
select public.create_user_model_config(
  '71000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-test-coding',
  'sk-test-a-coding-WXYZ',
  false
);
select public.create_user_model_config(
  '71000000-0000-4000-8000-000000000002',
  'openai',
  'gpt-test-user-b',
  'sk-test-b-private-9999',
  true
);

select private.assert_count(
  'one default per user after creation',
  (select count(*) from public.user_model_configs where user_id = '71000000-0000-4000-8000-000000000001' and is_default),
  1
);
select private.assert_count(
  'plaintext key is absent from business table',
  (select count(*) from public.user_model_configs as config where to_jsonb(config)::text like '%sk-test%'),
  0
);
select private.assert_count(
  'masked list does not return full key',
  (select count(*) from public.list_user_model_configs('71000000-0000-4000-8000-000000000001') where api_key_masked like '%sk-test%'),
  0
);
select private.assert_text(
  'masked list retains only safe suffix',
  (select api_key_masked from public.list_user_model_configs('71000000-0000-4000-8000-000000000001') where model = 'gpt-test-default'),
  'sk-••••••••••••ABCD'
);

reset role;

-- The partial unique index rejects any attempt to create two defaults.
do $$
begin
  begin
    update public.user_model_configs
    set is_default = true
    where user_id = '71000000-0000-4000-8000-000000000001';
    raise exception 'two defaults were unexpectedly accepted';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- User A can only see their own model metadata.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select private.assert_count(
  'user A sees own model configs',
  (select count(*) from public.user_model_configs),
  2
);
select private.assert_count(
  'user A cannot see user B model config',
  (select count(*) from public.user_model_configs where user_id = '71000000-0000-4000-8000-000000000002'),
  0
);

insert into public.agent_model_preferences (user_id, agent_type, model_config_id)
select
  '71000000-0000-4000-8000-000000000001',
  'coding',
  id
from public.user_model_configs
where user_id = '71000000-0000-4000-8000-000000000001'
  and model = 'gpt-test-coding';

-- Composite FK rejects a cross-user model reference even though user_id passes RLS.
do $$
declare
  user_b_config_id uuid;
begin
  select config.id
  into user_b_config_id
  from public.user_model_configs as config
  where config.user_id = '71000000-0000-4000-8000-000000000002';

  -- RLS intentionally hides the row from this authenticated user.
  if user_b_config_id is not null then
    raise exception 'RLS exposed user B model config';
  end if;
end;
$$;
reset role;

-- Test the ownership FK with user B's hidden fixture id, then catch rejection as user A.
do $$
declare
  user_b_config_id uuid;
begin
  user_b_config_id := private.test_config_id(
    '71000000-0000-4000-8000-000000000002',
    'gpt-test-user-b'
  );

  begin
    insert into public.agent_model_preferences (user_id, agent_type, model_config_id)
    values ('71000000-0000-4000-8000-000000000001', 'design', user_b_config_id);
    raise exception 'cross-user preference was unexpectedly accepted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;
reset role;

set local role service_role;
select private.assert_text(
  'agent preference overrides default',
  (select model from public.resolve_user_model_config('71000000-0000-4000-8000-000000000001', 'coding')),
  'gpt-test-coding'
);
select private.assert_text(
  'agent without preference falls back to default',
  (select model from public.resolve_user_model_config('71000000-0000-4000-8000-000000000001', 'planning')),
  'gpt-test-default'
);
select private.assert_text(
  'resolve returns key only in service-only context',
  (select api_key from public.resolve_user_model_config('71000000-0000-4000-8000-000000000001', 'coding')),
  'sk-test-a-coding-WXYZ'
);

select public.delete_user_model_config(
  '71000000-0000-4000-8000-000000000001',
  (select id from public.user_model_configs where user_id = '71000000-0000-4000-8000-000000000001' and model = 'gpt-test-default')
);

select private.assert_count(
  'remaining model becomes default after deleting default',
  (select count(*) from public.user_model_configs where user_id = '71000000-0000-4000-8000-000000000001' and model = 'gpt-test-coding' and is_default),
  1
);
select private.assert_text(
  'fallback resolves reassigned default after deletion',
  (select model from public.resolve_user_model_config('71000000-0000-4000-8000-000000000001', 'planning')),
  'gpt-test-coding'
);
reset role;

select private.assert_count(
  'authenticated cannot call secret resolver',
  has_function_privilege('authenticated', 'public.resolve_user_model_config(uuid,text)', 'execute')::int,
  0
);
select private.assert_count(
  'anonymous cannot call masked listing function',
  has_function_privilege('anon', 'public.list_user_model_configs(uuid)', 'execute')::int,
  0
);

select 'all model configuration and Vault assertions passed' as result;

rollback;
