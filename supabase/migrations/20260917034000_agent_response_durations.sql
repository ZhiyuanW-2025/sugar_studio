begin;

alter table public.messages
  add column generation_duration_ms integer
  check (generation_duration_ms is null or generation_duration_ms between 0 and 86400000);

drop function public.append_agent_turn(uuid, uuid, uuid, text, text);

create function public.append_agent_turn(
  p_thread_id uuid,
  p_conversation_id uuid,
  p_request_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_assistant_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  user_row public.messages%rowtype;
  assistant_row public.messages%rowtype;
begin
  if caller_id is null
    or p_request_id is null
    or nullif(btrim(p_user_content), '') is null
    or nullif(btrim(p_assistant_content), '') is null
    or p_assistant_duration_ms is null
    or p_assistant_duration_ms < 0
    or p_assistant_duration_ms > 86400000
  then
    raise exception using errcode = '23514', message = 'A complete authenticated turn is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text || ':' || p_request_id::text, 0));

  if not exists (
    select 1
    from public.agent_conversations conversation
    join public.agent_threads thread on thread.id = conversation.thread_id
    where conversation.id = p_conversation_id
      and conversation.thread_id = p_thread_id
      and conversation.status = 'active'
      and thread.user_id = caller_id
      and private.is_project_member(thread.project_id)
  ) then
    raise exception using errcode = '42501', message = 'Conversation access denied.';
  end if;

  select * into user_row
  from public.messages
  where conversation_id = p_conversation_id and request_id = p_request_id and role = 'user';

  select * into assistant_row
  from public.messages
  where conversation_id = p_conversation_id and request_id = p_request_id and role = 'assistant';

  if user_row.id is not null and assistant_row.id is not null then
    return jsonb_build_object(
      'userMessage', jsonb_build_object(
        'id', user_row.id,
        'role', user_row.role,
        'content', user_row.content,
        'createdAt', user_row.created_at,
        'durationMs', user_row.generation_duration_ms
      ),
      'assistantMessage', jsonb_build_object(
        'id', assistant_row.id,
        'role', assistant_row.role,
        'content', assistant_row.content,
        'createdAt', assistant_row.created_at,
        'durationMs', assistant_row.generation_duration_ms
      )
    );
  end if;

  if user_row.id is not null or assistant_row.id is not null then
    raise exception using errcode = '23514', message = 'Incomplete stored turn.';
  end if;

  insert into public.messages (thread_id, conversation_id, request_id, role, content)
  values (p_thread_id, p_conversation_id, p_request_id, 'user', btrim(p_user_content))
  returning * into user_row;

  insert into public.messages (
    thread_id,
    conversation_id,
    request_id,
    role,
    content,
    generation_duration_ms
  )
  values (
    p_thread_id,
    p_conversation_id,
    p_request_id,
    'assistant',
    btrim(p_assistant_content),
    p_assistant_duration_ms
  )
  returning * into assistant_row;

  update public.agent_conversations set updated_at = now() where id = p_conversation_id;
  update public.agent_threads set updated_at = now() where id = p_thread_id;

  return jsonb_build_object(
    'userMessage', jsonb_build_object(
      'id', user_row.id,
      'role', user_row.role,
      'content', user_row.content,
      'createdAt', user_row.created_at,
      'durationMs', user_row.generation_duration_ms
    ),
    'assistantMessage', jsonb_build_object(
      'id', assistant_row.id,
      'role', assistant_row.role,
      'content', assistant_row.content,
      'createdAt', assistant_row.created_at,
      'durationMs', assistant_row.generation_duration_ms
    )
  );
end;
$$;

revoke all on function public.append_agent_turn(uuid, uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.append_agent_turn(uuid, uuid, uuid, text, text, integer) to authenticated;

comment on column public.messages.generation_duration_ms is
  'Server-observed elapsed time for an Agent-generated assistant message; null for user and legacy messages.';

commit;
