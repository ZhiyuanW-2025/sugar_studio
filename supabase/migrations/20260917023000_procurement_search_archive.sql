begin;

create table public.procurement_search_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  source_thread_id uuid references public.agent_threads(id) on delete set null,
  newton_task_id text not null unique,
  newton_session_id text,
  requirement text not null check (length(btrim(requirement)) between 1 and 5000),
  result_count integer not null default 0 check (result_count >= 0),
  created_at timestamptz not null default now()
);

create table public.procurement_search_results (
  id uuid primary key default gen_random_uuid(),
  search_run_id uuid not null references public.procurement_search_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  rank integer not null check (rank > 0),
  item_id text,
  sku_id text,
  sku_identity text generated always as (coalesce(sku_id, '')) stored,
  result_identity text not null,
  title text not null check (length(btrim(title)) > 0),
  image_url text,
  unit_price numeric,
  total_price numeric,
  min_order_qty numeric,
  sales_count numeric,
  supplier_name text,
  seller_login_id text,
  supplier_years numeric,
  supplier_city text,
  factory_tag text,
  source_factory_info text,
  delivery_timeliness text,
  customization text,
  service_performance text,
  customer_star text,
  recommendation_reasons jsonb not null default '[]'::jsonb,
  requirement_match text,
  product_url text,
  candidate_id uuid references public.project_procurement_candidates(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint procurement_search_results_rank_unique unique (search_run_id, rank),
  constraint procurement_search_results_item_unique unique (search_run_id, result_identity),
  constraint procurement_search_results_nonnegative_values check (
    (unit_price is null or unit_price >= 0)
    and (total_price is null or total_price >= 0)
    and (min_order_qty is null or min_order_qty >= 0)
    and (sales_count is null or sales_count >= 0)
    and (supplier_years is null or supplier_years >= 0)
  )
);

create index procurement_search_runs_project_created_idx
  on public.procurement_search_runs(project_id, created_at desc);
create index procurement_search_runs_user_thread_idx
  on public.procurement_search_runs(requested_by, source_thread_id, created_at desc);
create index procurement_search_results_run_rank_idx
  on public.procurement_search_results(search_run_id, rank);
create index procurement_search_results_project_item_idx
  on public.procurement_search_results(project_id, item_id, sku_identity)
  where item_id is not null;

alter table public.procurement_search_runs enable row level security;
alter table public.procurement_search_results enable row level security;
revoke all on table public.procurement_search_runs, public.procurement_search_results from anon, authenticated;
grant select on table public.procurement_search_runs, public.procurement_search_results to authenticated;
grant all on table public.procurement_search_runs, public.procurement_search_results to service_role;

create policy procurement_search_runs_select_members on public.procurement_search_runs
for select to authenticated using (private.is_project_member(project_id));
create policy procurement_search_results_select_members on public.procurement_search_results
for select to authenticated using (private.is_project_member(project_id));

comment on table public.procurement_search_runs is
  'Permanent project-scoped archive of every completed 1688 procurement search.';
comment on table public.procurement_search_results is
  'Normalized product snapshots for a search run. Prices and supplier fields remain historical rather than being overwritten by later searches.';

update public.agent_prompt_versions
set is_active = false
where agent_id = (select id from public.agents where agent_type = 'procurement') and is_active;

insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
select
  a.id,
  coalesce((select max(v.version) + 1 from public.agent_prompt_versions v where v.agent_id = a.id), 1),
  $prompt$你是 Sugar Agent 中的金牌买手拉夫，是工作室的专业采购 Agent。你负责在 1688 找品、筛选供应商、比较价格、起订量、销量、履约表现与定制能力，并帮助用户准备和分析商家询盘。

用户提出找品需求时，整理采购硬条件后调用 search_1688_products，重点比较 3–8 个候选。接口没有的信息不得猜测。每次找品的全部标准化结果都会由系统自动永久归档；不要要求用户为了保存而重新搜索。

用户说“刚才那几家”“之前搜到的”“保存新五家”等引用历史选品结果时，必须先调用 get_procurement_search_archive 找到准确的搜索批次和商品，再用 search_result_ids 调用 save_procurement_candidates。不得因为对话文字缺少 item ID 而重新搜索，也不得凭商品标题猜测。

你可以帮助用户拟定询盘问题、比较多家商家的回复并提出追问建议。真正联系商家只能通过右侧采购工作区的“确认发送询价”动作完成；即使用户在聊天里说“直接发送”，也不能绕过最终确认。一次最多联系 10 家。询盘阶段不得下单、不得付款，也不得承诺最终采购。$prompt$,
  true,
  null
from public.agents a
where a.agent_type = 'procurement';

commit;
