begin;

drop policy if exists feishu_documents_select_workspace_members
  on public.feishu_knowledge_documents;
create policy feishu_documents_select_allowed_members
on public.feishu_knowledge_documents for select to authenticated
using (
  (scope_type = 'company' and private.is_workspace_member())
  or (scope_type = 'project' and private.is_project_member(project_id))
);

drop policy if exists feishu_change_proposals_select_workspace_members
  on public.feishu_knowledge_change_proposals;
create policy feishu_change_proposals_select_allowed_members
on public.feishu_knowledge_change_proposals for select to authenticated
using (
  (project_id is null and private.is_workspace_member())
  or (project_id is not null and private.is_project_member(project_id))
);

-- Sync event payloads are an internal ingestion queue. Members use the
-- resulting knowledge documents and never need direct access to raw events.
drop policy if exists feishu_sync_events_select_workspace_members
  on public.feishu_sync_events;
revoke select on table public.feishu_sync_events from authenticated;

comment on policy feishu_documents_select_allowed_members
  on public.feishu_knowledge_documents is
  'Company mappings are workspace-visible; project mappings require membership in that project.';
comment on policy feishu_change_proposals_select_allowed_members
  on public.feishu_knowledge_change_proposals is
  'Company changes are workspace-visible; project changes require membership in that project.';

commit;
