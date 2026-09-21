-- Run with: npx supabase db query --linked --file supabase/tests/design_image_generation.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('79000000-0000-4000-8000-000000000001', 'image-a@sugar.invalid', '{}', now(), now()),
  ('79000000-0000-4000-8000-000000000002', 'image-b@sugar.invalid', '{}', now(), now());

insert into public.projects (id, name)
values ('79000000-0000-4000-8000-000000000101', 'Image Project');

insert into public.project_members (project_id, user_id, role)
values ('79000000-0000-4000-8000-000000000101', '79000000-0000-4000-8000-000000000001', 'member');

do $$
declare
  secret_a uuid;
  secret_b uuid;
begin
  select vault.create_secret('sk-test-a', 'image-test-a') into secret_a;
  select vault.create_secret('sk-test-b', 'image-test-b') into secret_b;

  insert into public.user_model_configs (
    id, user_id, provider, model, api_key_secret_id, is_default
  ) values
    ('79000000-0000-4000-8000-000000000201', '79000000-0000-4000-8000-000000000001', 'openai', 'gpt-5.6-sol', secret_a, true),
    ('79000000-0000-4000-8000-000000000202', '79000000-0000-4000-8000-000000000002', 'openai', 'gpt-5.6-sol', secret_b, true);
end;
$$;

insert into public.image_generations (
  id, request_id, project_id, user_id, provider, model, prompt,
  size, quality, output_format, status, storage_path, mime_type, completed_at
) values (
  '79000000-0000-4000-8000-000000000301',
  '79000000-0000-4000-8000-000000000302',
  '79000000-0000-4000-8000-000000000101',
  '79000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-image-2.5-flare',
  'Test prompt',
  '1024x1024',
  'medium',
  'png',
  'completed',
  '79000000-0000-4000-8000-000000000101/79000000-0000-4000-8000-000000000301/output.png',
  'image/png',
  now()
);

insert into public.image_generations (
  id, request_id, project_id, user_id, provider, model, prompt,
  size, quality, output_format, status, storage_path, mime_type, completed_at,
  operation, source_generation_id, source_storage_path, source_mime_type
) values (
  '79000000-0000-4000-8000-000000000303',
  '79000000-0000-4000-8000-000000000304',
  '79000000-0000-4000-8000-000000000101',
  '79000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-image-2.5-sunburst',
  'Keep the composition and change the background color',
  '1024x1024',
  'medium',
  'png',
  'completed',
  '79000000-0000-4000-8000-000000000101/79000000-0000-4000-8000-000000000303/output.png',
  'image/png',
  now(),
  'edit',
  '79000000-0000-4000-8000-000000000301',
  '79000000-0000-4000-8000-000000000101/79000000-0000-4000-8000-000000000301/output.png',
  'image/png'
);

do $$
begin
  begin
    insert into public.image_generations (
      request_id, project_id, user_id, provider, model, prompt,
      status, storage_path, mime_type, completed_at, operation
    ) values (
      gen_random_uuid(),
      '79000000-0000-4000-8000-000000000101',
      '79000000-0000-4000-8000-000000000001',
      'openai',
      'gpt-image-2.5-flare',
      'Invalid edit without a stable source',
      'completed',
      '79000000-0000-4000-8000-000000000101/79000000-0000-4000-8000-000000000399/output.png',
      'image/png',
      now(),
      'edit'
    );
    raise exception 'completed edit without a stable source was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);

insert into public.image_model_preferences (user_id, provider, model, credential_config_id)
values (
  '79000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-image-2.5-sunburst',
  '79000000-0000-4000-8000-000000000201'
);

do $$
begin
  if (select count(*) from public.image_generations) <> 2 then
    raise exception 'project member cannot read generated images';
  end if;

  if not exists (
    select 1 from public.image_generations
    where operation = 'edit'
      and source_generation_id = '79000000-0000-4000-8000-000000000301'
  ) then
    raise exception 'image edit lineage was not retained';
  end if;

  perform public.set_image_generation_approval(
    '79000000-0000-4000-8000-000000000101',
    '79000000-0000-4000-8000-000000000301',
    true
  );
  if not exists (
    select 1
    from public.image_generations
    where id = '79000000-0000-4000-8000-000000000301'
      and review_status = 'approved'
      and approved_by = '79000000-0000-4000-8000-000000000001'
      and approved_at is not null
  ) then
    raise exception 'project member could not approve a completed image';
  end if;
  if not exists (
    select 1
    from public.project_activities
    where event_type = 'design_image_approved'
      and related_entity_id = '79000000-0000-4000-8000-000000000301'
  ) then
    raise exception 'image approval activity was not recorded';
  end if;

  perform public.set_image_generation_approval(
    '79000000-0000-4000-8000-000000000101',
    '79000000-0000-4000-8000-000000000301',
    false
  );
  if not exists (
    select 1
    from public.image_generations
    where id = '79000000-0000-4000-8000-000000000301'
      and review_status = 'draft'
      and approved_by is null
      and approved_at is null
  ) then
    raise exception 'project member could not revoke image approval';
  end if;
  if not exists (
    select 1
    from public.project_activities
    where event_type = 'design_image_approval_revoked'
      and related_entity_id = '79000000-0000-4000-8000-000000000301'
  ) then
    raise exception 'image approval revocation activity was not recorded';
  end if;

  begin
    update public.image_model_preferences
    set credential_config_id = '79000000-0000-4000-8000-000000000202'
    where user_id = '79000000-0000-4000-8000-000000000001';
    raise exception 'user A referenced user B credential';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.image_generations (
      request_id, project_id, user_id, provider, model, prompt
    ) values (
      gen_random_uuid(),
      '79000000-0000-4000-8000-000000000101',
      '79000000-0000-4000-8000-000000000001',
      'openai',
      'gpt-image-2.5-flare',
      'Bypass server boundary'
    );
    raise exception 'authenticated user inserted image generation directly';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.image_generations
    set review_status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = '79000000-0000-4000-8000-000000000301';
    raise exception 'authenticated user updated image approval without the RPC';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (select 1 from public.image_model_preferences) then
    raise exception 'user B can read user A image preference';
  end if;
  if exists (select 1 from public.image_generations) then
    raise exception 'non-member can read project image generations';
  end if;
  begin
    perform public.set_image_generation_approval(
      '79000000-0000-4000-8000-000000000101',
      '79000000-0000-4000-8000-000000000301',
      true
    );
    raise exception 'non-member approved a project image';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  resolved record;
begin
  select * into resolved
  from public.resolve_user_image_model_config('79000000-0000-4000-8000-000000000001');
  if resolved.model <> 'gpt-image-2.5-sunburst'
     or resolved.credential_config_id <> '79000000-0000-4000-8000-000000000201'
     or resolved.api_key <> 'sk-test-a' then
    raise exception 'explicit image model preference did not resolve safely';
  end if;
end;
$$;

select 'image ownership, edit lineage, approval RPC, project RLS, server-write boundary, and Vault resolution passed' as result;

rollback;
