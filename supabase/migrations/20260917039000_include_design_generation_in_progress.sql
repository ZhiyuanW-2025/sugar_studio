begin;

update public.project_activities
set
  category = 'material',
  progress_status = 'completed',
  source_type = 'system_action'
where event_type = 'design_image_generated';

create or replace function public.classify_project_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'manual_progress' then
    new.source_type := 'manual';
    new.progress_status := 'completed';
    return new;
  end if;

  new.source_type := 'system_action';
  new.category := case
    when new.event_type in ('plan_version_saved', 'plan_version_rolled_back', 'project_context_updated') then 'decision'
    when new.event_type in ('project_file_uploaded', 'project_file_version_uploaded', 'project_file_deleted', 'project_file_moved_out', 'design_image_generated', 'design_image_approved', 'design_image_approval_revoked', 'client_deliverable_approved') then 'material'
    when new.event_type in ('repository_bound', 'coding_run_completed', 'git_commit', 'git_push', 'handoff_task_delivered', 'collaboration_task_delivered') then 'execution'
    when new.event_type in ('client_deliverable_dispatched', 'procurement_inquiry_sent', 'procurement_follow_up_sent') then 'external'
    when new.event_type like '%failed' then 'exception'
    else 'management'
  end;
  new.progress_status := case when new.event_type like '%failed' then 'failed' else 'completed' end;
  return new;
end;
$$;

commit;
