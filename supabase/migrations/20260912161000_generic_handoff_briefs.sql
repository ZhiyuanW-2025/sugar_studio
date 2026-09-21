begin;
alter table public.handoff_tasks
  drop constraint handoff_tasks_brief_type_check,
  drop constraint handoff_tasks_brief_matches_target_check,
  drop constraint handoff_tasks_title_matches_brief_check,
  drop constraint handoff_tasks_valid_brief_check,
  alter column brief_type set default 'generic',
  alter column brief set default '{}'::jsonb,
  add constraint handoff_tasks_brief_type_check check(brief_type in ('technical','visual','generic')),
  add constraint handoff_tasks_brief_matches_target_check check(
    brief_type='generic' or (target_agent='coding' and brief_type='technical') or (target_agent='design' and brief_type='visual')
  ),
  add constraint handoff_tasks_title_matches_brief_check check(brief_type='generic' or title=brief->>'title'),
  add constraint handoff_tasks_valid_brief_check check(brief_type='generic' or private.is_valid_handoff_brief(brief_type,brief));
commit;
