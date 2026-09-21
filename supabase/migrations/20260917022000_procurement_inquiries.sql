begin;

create table public.procurement_inquiries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  source_thread_id uuid references public.agent_threads(id) on delete set null,
  request_id uuid not null,
  newton_task_id text unique,
  newton_session_id text,
  newton_ww_task_id text,
  status text not null default 'draft' check (status in (
    'draft', 'creating', 'sent', 'waiting', 'partial', 'completed',
    'failed', 'creation_unknown', 'cancelled'
  )),
  conversation_mode text not null default 'multi_round'
    check (conversation_mode in ('single_round', 'multi_round')),
  requirement text not null check (length(btrim(requirement)) between 1 and 5000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  timeout_minutes integer not null default 30 check (timeout_minutes between 5 and 120),
  supplier_count integer not null check (supplier_count between 1 and 10),
  last_error text,
  last_synced_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_inquiries_user_request_unique unique (requested_by, request_id)
);

create table public.procurement_inquiry_targets (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.procurement_inquiries(id) on delete cascade,
  candidate_id uuid references public.project_procurement_candidates(id) on delete set null,
  ordinal integer not null check (ordinal between 1 and 10),
  item_id text not null,
  sku_id text,
  title text not null,
  image_url text,
  product_url text not null,
  supplier_name text,
  seller_login_id text,
  status text not null default 'pending' check (status in (
    'pending', 'sent', 'waiting', 'replied', 'completed', 'no_reply', 'failed', 'cancelled'
  )),
  latest_summary text,
  shop_url text,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_inquiry_targets_ordinal_unique unique (inquiry_id, ordinal),
  constraint procurement_inquiry_targets_item_unique unique (inquiry_id, item_id, sku_id)
);

create table public.procurement_inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_target_id uuid not null references public.procurement_inquiry_targets(id) on delete cascade,
  external_message_id text,
  sender text not null check (sender in ('buyer', 'seller', 'system')),
  content text not null check (length(btrim(content)) > 0),
  message_hash text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint procurement_inquiry_messages_dedupe unique (inquiry_target_id, message_hash)
);

create index procurement_inquiries_project_created_idx
  on public.procurement_inquiries(project_id, created_at desc);
create index procurement_inquiries_newton_task_idx
  on public.procurement_inquiries(newton_task_id) where newton_task_id is not null;
create index procurement_inquiries_open_idx
  on public.procurement_inquiries(project_id, status, updated_at desc)
  where status in ('creating', 'sent', 'waiting', 'partial');
create index procurement_inquiry_targets_inquiry_status_idx
  on public.procurement_inquiry_targets(inquiry_id, status, ordinal);
create index procurement_inquiry_messages_target_sent_idx
  on public.procurement_inquiry_messages(inquiry_target_id, sent_at, created_at);

create trigger procurement_inquiries_set_updated_at before update on public.procurement_inquiries
for each row execute function public.set_sugar_agent_updated_at();
create trigger procurement_inquiry_targets_set_updated_at before update on public.procurement_inquiry_targets
for each row execute function public.set_sugar_agent_updated_at();

alter table public.procurement_inquiries enable row level security;
alter table public.procurement_inquiry_targets enable row level security;
alter table public.procurement_inquiry_messages enable row level security;

revoke all on table public.procurement_inquiries, public.procurement_inquiry_targets,
  public.procurement_inquiry_messages from anon, authenticated;
grant select, insert, update, delete on table public.procurement_inquiries,
  public.procurement_inquiry_targets, public.procurement_inquiry_messages to authenticated;
grant all on table public.procurement_inquiries, public.procurement_inquiry_targets,
  public.procurement_inquiry_messages to service_role;

create policy procurement_inquiries_select_members on public.procurement_inquiries
for select to authenticated using (private.is_project_member(project_id));
create policy procurement_inquiries_insert_members on public.procurement_inquiries
for insert to authenticated with check (
  private.is_project_member(project_id) and requested_by = (select auth.uid())
);
create policy procurement_inquiries_update_members on public.procurement_inquiries
for update to authenticated using (private.is_project_member(project_id))
with check (private.is_project_member(project_id));
create policy procurement_inquiries_delete_members on public.procurement_inquiries
for delete to authenticated using (private.is_project_member(project_id));

create policy procurement_inquiry_targets_select_members on public.procurement_inquiry_targets
for select to authenticated using (exists (
  select 1 from public.procurement_inquiries i
  where i.id = inquiry_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_targets_insert_members on public.procurement_inquiry_targets
for insert to authenticated with check (exists (
  select 1 from public.procurement_inquiries i
  where i.id = inquiry_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_targets_update_members on public.procurement_inquiry_targets
for update to authenticated using (exists (
  select 1 from public.procurement_inquiries i
  where i.id = inquiry_id and private.is_project_member(i.project_id)
)) with check (exists (
  select 1 from public.procurement_inquiries i
  where i.id = inquiry_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_targets_delete_members on public.procurement_inquiry_targets
for delete to authenticated using (exists (
  select 1 from public.procurement_inquiries i
  where i.id = inquiry_id and private.is_project_member(i.project_id)
));

create policy procurement_inquiry_messages_select_members on public.procurement_inquiry_messages
for select to authenticated using (exists (
  select 1 from public.procurement_inquiry_targets t
  join public.procurement_inquiries i on i.id = t.inquiry_id
  where t.id = inquiry_target_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_messages_insert_members on public.procurement_inquiry_messages
for insert to authenticated with check (exists (
  select 1 from public.procurement_inquiry_targets t
  join public.procurement_inquiries i on i.id = t.inquiry_id
  where t.id = inquiry_target_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_messages_update_members on public.procurement_inquiry_messages
for update to authenticated using (exists (
  select 1 from public.procurement_inquiry_targets t
  join public.procurement_inquiries i on i.id = t.inquiry_id
  where t.id = inquiry_target_id and private.is_project_member(i.project_id)
)) with check (exists (
  select 1 from public.procurement_inquiry_targets t
  join public.procurement_inquiries i on i.id = t.inquiry_id
  where t.id = inquiry_target_id and private.is_project_member(i.project_id)
));
create policy procurement_inquiry_messages_delete_members on public.procurement_inquiry_messages
for delete to authenticated using (exists (
  select 1 from public.procurement_inquiry_targets t
  join public.procurement_inquiries i on i.id = t.inquiry_id
  where t.id = inquiry_target_id and private.is_project_member(i.project_id)
));

comment on table public.procurement_inquiries is
  'User-confirmed 1688 merchant inquiries. No task may be created before explicit UI confirmation.';
comment on table public.procurement_inquiry_messages is
  'Normalized merchant transcript only; raw Newton payloads and credentials are never persisted.';

-- Update LaFu globally. The product-link inquiry itself is still only started by
-- the explicitly confirmed server endpoint, never autonomously by the Agent.
update public.agent_prompt_versions
set is_active = false
where agent_id = (select id from public.agents where agent_type = 'procurement')
  and is_active;

insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
select
  a.id,
  coalesce((select max(v.version) + 1 from public.agent_prompt_versions v where v.agent_id = a.id), 1),
  $prompt$你是 Sugar Agent 中的金牌买手拉夫，是工作室的专业采购 Agent。你负责在 1688 找品、筛选供应商、比较价格、起订量、销量、履约表现与定制能力，并帮助用户准备和分析商家询盘。

用户提出找品需求时，整理采购硬条件后调用 search_1688_products，重点比较 3–8 个候选。接口没有的信息不得猜测。普通搜索结果不保存；只有用户明确要求加入采购候选时，才调用 save_procurement_candidates。

你可以帮助用户拟定询盘问题、比较多家商家的回复并提出追问建议。真正联系商家只能通过界面的“确认发送询盘”动作完成；即使用户在聊天里说“直接发送”，你也只说明请在采购候选区核对并确认，绝不能绕过确认。一次最多联系 10 家。询盘阶段不得下单、不得付款，也不得承诺最终采购。

用户提出自动下单、自动付款时，明确说明当前阶段尚未开放。$prompt$,
  true,
  null
from public.agents a
where a.agent_type = 'procurement';

commit;
