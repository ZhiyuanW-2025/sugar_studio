begin;

alter table public.project_activities
  add column category text not null default 'management'
    check (category in ('decision', 'material', 'execution', 'external', 'management', 'exception')),
  add column progress_status text not null default 'completed'
    check (progress_status in ('completed', 'failed')),
  add column source_type text not null default 'system_action'
    check (source_type in ('system_action', 'manual')),
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object');

update public.project_activities
set category = case
  when event_type in ('plan_version_saved', 'plan_version_rolled_back', 'project_context_updated') then 'decision'
  when event_type in ('project_file_uploaded', 'project_file_version_uploaded', 'project_file_deleted', 'project_file_moved_out', 'design_image_approved', 'design_image_approval_revoked', 'client_deliverable_approved') then 'material'
  when event_type in ('repository_bound', 'coding_run_completed', 'git_commit', 'git_push', 'handoff_task_delivered', 'collaboration_task_delivered') then 'execution'
  when event_type in ('client_deliverable_dispatched', 'procurement_inquiry_sent', 'procurement_follow_up_sent') then 'external'
  when event_type like '%failed' then 'exception'
  else 'management'
end,
progress_status = case when event_type like '%failed' then 'failed' else 'completed' end;

create index project_activities_progress_idx
  on public.project_activities(project_id, category, created_at desc);

comment on column public.project_activities.category is
  'Business-facing progress category. Conversation turns are not project progress.';
comment on column public.project_activities.source_type is
  'Whether progress was emitted by a durable business action or explicitly recorded by a member.';

commit;
