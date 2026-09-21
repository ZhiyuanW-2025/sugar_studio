begin;

-- Repair only rows left by the previous copy-then-delete move implementation:
-- the source metadata still exists, its Storage object is already gone, and
-- the same checksum is present in the ordinary 工作室材料 project.
with ghost_pairs as (
  select
    source.id as source_file_id,
    source_document.id as source_document_id,
    target_document.id as target_document_id
  from public.project_files as source
  join public.projects as source_project on source_project.id = source.project_id
  join public.project_files as target
    on target.checksum = source.checksum
    and target.id <> source.id
    and target.superseded_at is null
  join public.projects as target_project
    on target_project.id = target.project_id
    and target_project.project_kind = 'workspace_materials'
  left join public.knowledge_documents as source_document on source_document.project_file_id = source.id
  left join public.knowledge_documents as target_document on target_document.project_file_id = target.id
  where source_project.project_kind = 'standard'
    and source.checksum is not null
    and source.superseded_at is null
    and not exists (
      select 1 from storage.objects as object
      where object.bucket_id = 'project-files' and object.name = source.storage_path
    )
)
update public.feishu_knowledge_change_proposals as proposal
set source_knowledge_document_id = pair.target_document_id
from ghost_pairs as pair
where pair.source_document_id is not null
  and pair.target_document_id is not null
  and proposal.source_knowledge_document_id = pair.source_document_id;

with ghost_files as (
  select source.id
  from public.project_files as source
  join public.projects as source_project on source_project.id = source.project_id
  where source_project.project_kind = 'standard'
    and source.checksum is not null
    and source.superseded_at is null
    and not exists (
      select 1 from storage.objects as object
      where object.bucket_id = 'project-files' and object.name = source.storage_path
    )
    and exists (
      select 1
      from public.project_files as target
      join public.projects as target_project on target_project.id = target.project_id
      where target_project.project_kind = 'workspace_materials'
        and target.checksum = source.checksum
        and target.superseded_at is null
    )
)
delete from public.project_files as source
using ghost_files as ghost
where source.id = ghost.id;

commit;
