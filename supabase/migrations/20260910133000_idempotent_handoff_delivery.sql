begin;

create function public.deliver_handoff_idempotently(
  p_project_id uuid,
  p_handoff_id uuid,
  p_title text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_task public.handoff_tasks%rowtype;
  v_message text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select * into v_task from public.handoff_tasks
  where id = p_handoff_id and project_id = p_project_id;
  if not found or v_task.created_by <> caller_id then
    raise exception using errcode = '42501', message = 'Handoff access denied.';
  end if;

  if v_task.status = 'delivered' then
    select content into v_message from public.messages
    where thread_id = v_task.target_thread_id
      and request_id = v_task.id
      and role = 'system';
    return jsonb_build_object(
      'taskId', v_task.id,
      'targetAgent', v_task.target_agent,
      'targetThreadId', v_task.target_thread_id,
      'title', v_task.title,
      'content', v_task.content,
      'message', v_message,
      'replayed', true
    );
  end if;

  return public.approve_and_deliver_handoff(
    p_project_id, p_handoff_id, p_title, p_content
  ) || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.deliver_handoff_idempotently(uuid, uuid, text, text) from public, anon;
grant execute on function public.deliver_handoff_idempotently(uuid, uuid, text, text) to authenticated;

comment on function public.deliver_handoff_idempotently(uuid, uuid, text, text)
  is 'Retry-safe handoff delivery; a delivered task returns its original result without duplicate messages or activities.';

commit;
