-- Run with: npx supabase db query --linked --file supabase/tests/project_files_storage_rls.sql
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  ('74000000-0000-4000-8000-000000000001', 'files-a@sugar.invalid', '{"display_name":"Files A"}', now(), now()),
  ('74000000-0000-4000-8000-000000000002', 'files-b@sugar.invalid', '{"display_name":"Files B"}', now(), now());

insert into public.projects (id, name)
values ('74000000-0000-4000-8000-000000000101', 'Project Files Test');

insert into public.project_members (project_id, user_id, role)
values ('74000000-0000-4000-8000-000000000101', '74000000-0000-4000-8000-000000000001', 'member');

set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);

select public.register_project_file(
  '74000000-0000-4000-8000-000000000201',
  '74000000-0000-4000-8000-000000000101',
  'brief.pdf',
  '74000000-0000-4000-8000-000000000101/74000000-0000-4000-8000-000000000201/brief.pdf',
  'pdf',
  'application/pdf',
  2048
);

do $$
begin
  if not exists (
    select 1 from public.project_files
    where id = '74000000-0000-4000-8000-000000000201'
      and uploaded_by = '74000000-0000-4000-8000-000000000001'
      and mime_type = 'application/pdf'
      and size = 2048
  ) then
    raise exception 'member file registration did not retain metadata';
  end if;

  if not exists (
    select 1 from public.project_activities
    where related_entity_id = '74000000-0000-4000-8000-000000000201'
      and event_type = 'project_file_uploaded'
  ) then
    raise exception 'upload activity was not recorded';
  end if;

  begin
    insert into public.project_files (
      id, project_id, file_name, storage_path, file_type, mime_type, size, uploaded_by
    ) values (
      '74000000-0000-4000-8000-000000000202',
      '74000000-0000-4000-8000-000000000101',
      'bypass.txt',
      '74000000-0000-4000-8000-000000000101/74000000-0000-4000-8000-000000000202/bypass.txt',
      'txt',
      'text/plain',
      1,
      '74000000-0000-4000-8000-000000000001'
    );
    raise exception 'direct metadata insert was unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (select 1 from public.project_files) then
    raise exception 'non-member can read project files';
  end if;

  begin
    perform public.register_project_file(
      '74000000-0000-4000-8000-000000000203',
      '74000000-0000-4000-8000-000000000101',
      'forbidden.txt',
      '74000000-0000-4000-8000-000000000101/74000000-0000-4000-8000-000000000203/forbidden.txt',
      'txt',
      'text/plain',
      1
    );
    raise exception 'non-member file registration was unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.remove_project_file(
      '74000000-0000-4000-8000-000000000101',
      '74000000-0000-4000-8000-000000000201'
    );
    raise exception 'non-member metadata removal was unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);

select public.remove_project_file(
  '74000000-0000-4000-8000-000000000101',
  '74000000-0000-4000-8000-000000000201'
);

do $$
begin
  if exists (
    select 1 from public.project_files
    where id = '74000000-0000-4000-8000-000000000201'
  ) then
    raise exception 'member metadata removal failed';
  end if;

  if not exists (
    select 1 from public.project_activities
    where related_entity_id = '74000000-0000-4000-8000-000000000201'
      and event_type = 'project_file_deleted'
  ) then
    raise exception 'delete activity was not recorded';
  end if;
end;
$$;

select 'project file metadata, activity, direct-write protection, and RLS assertions passed' as result;

rollback;
