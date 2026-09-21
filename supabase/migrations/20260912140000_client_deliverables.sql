begin;

create table public.client_material_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  deliverable_type text not null check (deliverable_type in ('proposal', 'meeting_notes', 'progress_report', 'change_response', 'formal_message')),
  description text not null default '',
  outline text not null check (length(btrim(outline)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  deliverable_type text not null check (deliverable_type in ('proposal', 'meeting_notes', 'progress_report', 'change_response', 'formal_message')),
  title text not null check (length(btrim(title)) > 0),
  audience text not null default '',
  purpose text not null default '',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'dispatched', 'archived')),
  current_version_id uuid,
  approved_version_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_deliverable_versions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.client_deliverables (id) on delete cascade,
  version integer not null check (version > 0),
  content text not null check (length(btrim(content)) > 0),
  content_format text not null default 'markdown' check (content_format = 'markdown'),
  change_summary text not null default '创建初稿' check (length(btrim(change_summary)) > 0),
  source_thread_id uuid references public.agent_threads (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (deliverable_id, version),
  unique (id, deliverable_id)
);

alter table public.client_deliverables
  add constraint client_deliverables_current_version_same_document_fkey
  foreign key (current_version_id, id)
  references public.client_deliverable_versions (id, deliverable_id)
  deferrable initially deferred,
  add constraint client_deliverables_approved_version_same_document_fkey
  foreign key (approved_version_id, id)
  references public.client_deliverable_versions (id, deliverable_id)
  deferrable initially deferred,
  add constraint client_deliverables_approval_consistency_check check (
    (status in ('approved', 'dispatched') and approved_version_id is not null and approved_at is not null)
    or (status not in ('approved', 'dispatched'))
  );

create table public.client_delivery_dispatches (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.client_deliverables (id) on delete cascade,
  version_id uuid not null references public.client_deliverable_versions (id) on delete restrict,
  channel text not null check (channel in ('email', 'wecom')),
  recipient text not null check (length(btrim(recipient)) > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  requested_by uuid references auth.users (id) on delete set null,
  provider_message_id text,
  failure_summary text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_delivery_dispatch_status_check check (
    (status = 'sent' and sent_at is not null and failure_summary is null)
    or (status = 'failed' and failure_summary is not null)
    or status = 'pending'
  )
);

create index client_deliverables_project_updated_idx on public.client_deliverables (project_id, updated_at desc);
create index client_deliverable_versions_document_version_idx on public.client_deliverable_versions (deliverable_id, version desc);
create index client_dispatches_document_created_idx on public.client_delivery_dispatches (deliverable_id, created_at desc);

create trigger client_material_templates_set_updated_at before update on public.client_material_templates
for each row execute function public.set_sugar_agent_updated_at();
create trigger client_deliverables_set_updated_at before update on public.client_deliverables
for each row execute function public.set_sugar_agent_updated_at();

alter table public.client_material_templates enable row level security;
alter table public.client_deliverables enable row level security;
alter table public.client_deliverable_versions enable row level security;
alter table public.client_delivery_dispatches enable row level security;

revoke all on table public.client_material_templates, public.client_deliverables, public.client_deliverable_versions, public.client_delivery_dispatches from anon, authenticated;
grant select on table public.client_material_templates, public.client_deliverables, public.client_deliverable_versions, public.client_delivery_dispatches to authenticated;
grant select, insert, update, delete on table public.client_material_templates, public.client_deliverables, public.client_deliverable_versions, public.client_delivery_dispatches to service_role;

create policy client_material_templates_select_workspace
on public.client_material_templates for select to authenticated
using (private.is_workspace_member() and is_active);

create policy client_deliverables_select_members
on public.client_deliverables for select to authenticated
using (private.is_project_member(project_id));

create policy client_deliverable_versions_select_members
on public.client_deliverable_versions for select to authenticated
using (exists (
  select 1 from public.client_deliverables document
  where document.id = client_deliverable_versions.deliverable_id
    and private.is_project_member(document.project_id)
));

create policy client_delivery_dispatches_select_members
on public.client_delivery_dispatches for select to authenticated
using (exists (
  select 1 from public.client_deliverables document
  where document.id = client_delivery_dispatches.deliverable_id
    and private.is_project_member(document.project_id)
));

create function public.create_client_deliverable(
  p_project_id uuid,
  p_deliverable_type text,
  p_title text,
  p_audience text,
  p_purpose text,
  p_content text,
  p_source_thread_id uuid default null
)
returns public.client_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  document public.client_deliverables%rowtype;
  version_id uuid;
  actor_name text;
begin
  if caller_id is null or not private.is_project_member(p_project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_deliverable_type not in ('proposal', 'meeting_notes', 'progress_report', 'change_response', 'formal_message')
     or nullif(btrim(p_title), '') is null or nullif(btrim(p_content), '') is null then
    raise exception using errcode = '23514', message = 'Invalid client deliverable.';
  end if;
  if p_source_thread_id is not null and not exists (
    select 1 from public.agent_threads thread
    where thread.id = p_source_thread_id and thread.project_id = p_project_id
      and thread.user_id = caller_id and thread.agent_type = 'client'
  ) then
    raise exception using errcode = '42501', message = 'Client source thread access denied.';
  end if;

  insert into public.client_deliverables (project_id, deliverable_type, title, audience, purpose, created_by)
  values (p_project_id, p_deliverable_type, btrim(p_title), coalesce(btrim(p_audience), ''), coalesce(btrim(p_purpose), ''), caller_id)
  returning * into document;

  insert into public.client_deliverable_versions (deliverable_id, version, content, source_thread_id, created_by)
  values (document.id, 1, btrim(p_content), p_source_thread_id, caller_id)
  returning id into version_id;

  update public.client_deliverables set current_version_id = version_id where id = document.id returning * into document;
  select coalesce(nullif(btrim(display_name), ''), '项目成员') into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (project_id, user_id, event_type, actor_type, actor, summary, related_entity_id)
  values (p_project_id, caller_id, 'client_deliverable_created', 'user', coalesce(actor_name, '项目成员'), format('创建了客户材料草稿：%s', document.title), document.id);
  return document;
end;
$$;

create function public.append_client_deliverable_version(
  p_deliverable_id uuid,
  p_content text,
  p_change_summary text
)
returns public.client_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  document public.client_deliverables%rowtype;
  next_version integer;
  version_id uuid;
begin
  select * into document from public.client_deliverables where id = p_deliverable_id for update;
  if caller_id is null or document.id is null or not private.is_project_member(document.project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if nullif(btrim(p_content), '') is null or nullif(btrim(p_change_summary), '') is null then
    raise exception using errcode = '23514', message = 'Content and change summary are required.';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.client_deliverable_versions where deliverable_id = document.id;
  insert into public.client_deliverable_versions (deliverable_id, version, content, change_summary, created_by)
  values (document.id, next_version, btrim(p_content), btrim(p_change_summary), caller_id)
  returning id into version_id;
  update public.client_deliverables set current_version_id = version_id, status = 'draft', approved_version_id = null, approved_by = null, approved_at = null
  where id = document.id returning * into document;
  return document;
end;
$$;

create function public.approve_client_deliverable(p_deliverable_id uuid)
returns public.client_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  document public.client_deliverables%rowtype;
  actor_name text;
begin
  select * into document from public.client_deliverables where id = p_deliverable_id for update;
  if caller_id is null or document.id is null or not private.is_project_member(document.project_id) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if document.current_version_id is null then
    raise exception using errcode = '23514', message = 'Deliverable has no content version.';
  end if;
  update public.client_deliverables set status = 'approved', approved_version_id = current_version_id, approved_by = caller_id, approved_at = now()
  where id = document.id returning * into document;
  select coalesce(nullif(btrim(display_name), ''), '项目成员') into actor_name from public.profiles where id = caller_id;
  insert into public.project_activities (project_id, user_id, event_type, actor_type, actor, summary, related_entity_id)
  values (document.project_id, caller_id, 'client_deliverable_approved', 'user', coalesce(actor_name, '项目成员'), format('批准了客户材料：%s', document.title), document.id);
  return document;
end;
$$;

revoke all on function public.create_client_deliverable(uuid, text, text, text, text, text, uuid), public.append_client_deliverable_version(uuid, text, text), public.approve_client_deliverable(uuid) from public, anon;
grant execute on function public.create_client_deliverable(uuid, text, text, text, text, text, uuid), public.append_client_deliverable_version(uuid, text, text), public.approve_client_deliverable(uuid) to authenticated;

insert into public.client_material_templates (name, deliverable_type, description, outline) values
  ('B 端客户提案', 'proposal', '用于第一次完整呈现项目方案。', '# 项目背景\n# 核心目标\n# 方案概述\n# 执行安排\n# 待确认事项'),
  ('会议纪要', 'meeting_notes', '沉淀参会信息、结论与行动项。', '# 会议信息\n# 讨论要点\n# 已确认结论\n# 待确认事项\n# 行动项'),
  ('项目进度汇报', 'progress_report', '面向客户同步当前阶段与下一步。', '# 当前状态\n# 已完成\n# 正在进行\n# 风险与待确认\n# 下一步'),
  ('修改意见回复', 'change_response', '逐项回应客户修改意见并说明边界。', '# 修改意见摘要\n# 逐项回复\n# 保持不变的范围\n# 影响说明\n# 待客户确认'),
  ('正式沟通回复', 'formal_message', '用于邮件或企业微信的可复制正文。', '# 主题\n# 正文\n# 待确认事项\n# 下一步');

comment on table public.client_deliverables is 'Project-scoped client-facing materials with explicit approval state.';
comment on table public.client_deliverable_versions is 'Immutable revisions of a client deliverable.';
comment on table public.client_delivery_dispatches is 'Audited external dispatch attempts; only approved versions may be sent by server code.';

commit;
