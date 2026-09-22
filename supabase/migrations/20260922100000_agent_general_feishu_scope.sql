begin;

-- An Agent may point at one workspace-level Feishu Wiki root for reusable
-- working knowledge. The underlying documents remain in the existing company
-- knowledge mirror; this column only records which root is associated with
-- the Agent.
alter table public.agents
  add column general_feishu_scope_id uuid references public.feishu_sync_scopes(id) on delete set null;

create index agents_general_feishu_scope_idx
  on public.agents(general_feishu_scope_id)
  where general_feishu_scope_id is not null;

comment on column public.agents.general_feishu_scope_id is
  'Optional workspace-level Feishu Wiki root used as this Agent''s general knowledge source.';

commit;
