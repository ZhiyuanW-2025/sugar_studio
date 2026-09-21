insert into public.feishu_connections (
  name, tenant_url, status, validated_at
)
values (
  '工作室介绍', 'https://sscd-studio.feishu.cn', 'active', now()
)
on conflict (lower(tenant_url)) where tenant_url is not null and status <> 'disabled'
do update set
  name = excluded.name,
  status = 'active',
  validated_at = now(),
  last_error = null;

insert into public.feishu_sync_scopes (
  connection_id,
  scope_type,
  project_id,
  space_id,
  root_node_token,
  source_url,
  display_name,
  enabled,
  sync_frequency,
  sync_weekday,
  sync_hour_utc,
  next_full_sync_at,
  last_sync_status
)
select
  connection.id,
  'company',
  null,
  '7685811306217082059',
  null,
  'https://sscd-studio.feishu.cn/wiki/settings/7685811306217082059#permission_manage',
  '工作室介绍',
  true,
  'weekly',
  1,
  4,
  now(),
  'pending'
from public.feishu_connections connection
where lower(connection.tenant_url) = 'https://sscd-studio.feishu.cn'
  and connection.status <> 'disabled'
on conflict (
  connection_id,
  space_id,
  coalesce(root_node_token, ''),
  scope_type,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where enabled
do update set
  source_url = excluded.source_url,
  display_name = excluded.display_name,
  sync_frequency = excluded.sync_frequency,
  sync_weekday = excluded.sync_weekday,
  sync_hour_utc = excluded.sync_hour_utc,
  next_full_sync_at = least(public.feishu_sync_scopes.next_full_sync_at, now()),
  last_sync_error = null;
