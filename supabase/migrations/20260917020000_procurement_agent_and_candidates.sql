begin;

alter table public.agent_threads
  drop constraint if exists agent_threads_agent_type_check,
  add constraint agent_threads_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement'));

alter table public.agent_model_preferences
  drop constraint if exists agent_model_preferences_agent_type_check,
  add constraint agent_model_preferences_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement'));

alter table public.agents
  drop constraint if exists agents_agent_type_check,
  add constraint agents_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement'));

alter table public.feishu_knowledge_change_proposals
  drop constraint if exists feishu_knowledge_change_proposals_agent_type_check,
  add constraint feishu_knowledge_change_proposals_agent_type_check
    check (agent_type in ('planning', 'coding', 'design', 'client', 'procurement'));

insert into public.agents (agent_type, name, role_title, description)
values (
  'procurement',
  '金牌买手拉夫',
  '专业采购',
  '负责 1688 找品、供应商筛选、采购比较与候选整理。'
)
on conflict (agent_type) do update set
  name = excluded.name,
  role_title = excluded.role_title,
  description = excluded.description;

insert into public.agent_prompt_versions (
  agent_id,
  version,
  instructions,
  is_active,
  created_by
)
select
  agent.id,
  1,
  $prompt$你是 Sugar Agent 中的金牌买手拉夫，是工作室的专业采购 Agent。你负责根据项目需求在 1688 找品、筛选供应商、比较价格、起订量、销量、履约表现与定制能力，并给出可供人判断的采购候选。

当用户提出真实找品需求时，先把自然语言整理为清晰采购条件，再调用 search_1688_products。优先检查数量、预算、规格、材质、尺寸、交期和定制要求等硬条件，不得只按接口原始排序推荐。最终重点比较 3–8 个候选，明确逐项说明哪些条件满足、哪些不满足或接口没有返回。接口没提供的信息绝不能猜测；价格和库存可能变化，应提醒用户在采购前复核。

普通搜索结果不能保存。只有用户明确说“加入采购候选”或“保存到项目”并指明候选后，才可以调用 save_procurement_candidates。不能把全部搜索结果批量保存。

当前阶段严禁自动询盘、下单或付款，也不能假装已经联系供应商。用户提出这些动作时，明确说明能力尚未开放。你可以讨论询盘策略或采购判断，但不执行交易动作。

涉及当前项目事实、当前阶段或正式方案时，调用 get_project_context；需要从项目材料中提取采购条件时，调用 search_project_knowledge。输出使用简洁、专业的中文，先给结论和重点候选，再给横向比较与风险。$prompt$,
  true,
  null
from public.agents as agent
where agent.agent_type = 'procurement'
  and not exists (
    select 1 from public.agent_prompt_versions as prompt
    where prompt.agent_id = agent.id
  );

create or replace function public.resolve_user_model_config(
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
  if p_agent_type not in ('planning', 'coding', 'design', 'client', 'procurement') then
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

create or replace function public.save_agent_prompt(
  p_agent_type text,
  p_instructions text
)
returns public.agent_prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_agent public.agents%rowtype;
  v_version integer;
  v_result public.agent_prompt_versions%rowtype;
  v_actor text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not private.is_workspace_member() then
    raise exception using errcode = '42501', message = 'Workspace access denied.';
  end if;
  if p_agent_type not in ('planning', 'coding', 'design', 'client', 'procurement')
     or nullif(btrim(p_instructions), '') is null then
    raise exception using errcode = '23514', message = 'Invalid prompt.';
  end if;

  select * into v_agent
  from public.agents
  where agent_type = p_agent_type
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent not found.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions where agent_id = v_agent.id;

  update public.agent_prompt_versions set is_active = false
  where agent_id = v_agent.id and is_active;

  insert into public.agent_prompt_versions (
    agent_id, version, instructions, is_active, created_by
  ) values (
    v_agent.id, v_version, btrim(p_instructions), true, caller_id
  ) returning * into v_result;

  select coalesce(nullif(btrim(display_name), ''), '工作室成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.agent_config_activities (
    agent_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    v_agent.id, caller_id, 'agent_prompt_changed', 'user', coalesce(v_actor, '工作室成员'),
    format('更新了全局%s提示词至 v%s', v_agent.name, v_version), v_result.id
  );

  return v_result;
end;
$$;

create table public.project_procurement_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete restrict,
  item_id text not null check (length(btrim(item_id)) > 0),
  sku_id text,
  sku_identity text generated always as (coalesce(sku_id, '')) stored,
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
  user_confirmation text not null check (length(btrim(user_confirmation)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_procurement_candidates_unique_item unique (project_id, item_id, sku_identity),
  constraint project_procurement_candidates_nonnegative_values check (
    (unit_price is null or unit_price >= 0)
    and (total_price is null or total_price >= 0)
    and (min_order_qty is null or min_order_qty >= 0)
    and (sales_count is null or sales_count >= 0)
    and (supplier_years is null or supplier_years >= 0)
  )
);

create index project_procurement_candidates_project_created_idx
  on public.project_procurement_candidates(project_id, created_at desc);
create index project_procurement_candidates_supplier_idx
  on public.project_procurement_candidates(project_id, seller_login_id)
  where seller_login_id is not null;

create trigger project_procurement_candidates_set_updated_at
before update on public.project_procurement_candidates
for each row execute function public.set_sugar_agent_updated_at();

alter table public.project_procurement_candidates enable row level security;
revoke all on table public.project_procurement_candidates from anon, authenticated;
grant select, insert, update, delete on table public.project_procurement_candidates to authenticated;

create policy project_procurement_candidates_select_members
on public.project_procurement_candidates for select to authenticated
using (private.is_project_member(project_id));

create policy project_procurement_candidates_insert_members
on public.project_procurement_candidates for insert to authenticated
with check (private.is_project_member(project_id) and added_by = (select auth.uid()));

create policy project_procurement_candidates_update_members
on public.project_procurement_candidates for update to authenticated
using (private.is_project_member(project_id))
with check (private.is_project_member(project_id));

create policy project_procurement_candidates_delete_members
on public.project_procurement_candidates for delete to authenticated
using (private.is_project_member(project_id));

comment on table public.project_procurement_candidates is
  'Small, user-confirmed project shortlist from 1688 searches. Ordinary Newton search results are not persisted.';

comment on column public.project_procurement_candidates.user_confirmation is
  'Short record of the explicit user instruction that authorized saving the selected candidates.';

commit;
