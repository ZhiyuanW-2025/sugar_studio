begin;

-- The first version has one current thread for each user/project/agent tuple.
create unique index agent_threads_user_project_agent_key
  on public.agent_threads (user_id, project_id, agent_type);

-- One request id is shared by the user and assistant rows in a completed turn.
-- Existing rows predate sessions, so use their own ids as safe one-row groups.
alter table public.messages
  add column request_id uuid;

update public.messages
set request_id = id
where request_id is null;

alter table public.messages
  alter column request_id set not null;

create unique index messages_thread_request_role_key
  on public.messages (thread_id, request_id, role);

-- Append a complete turn in one database transaction. The function is
-- idempotent for a repeated request_id and performs its own ownership check
-- because SECURITY DEFINER functions bypass table RLS.
create function public.append_agent_turn(
  p_thread_id uuid,
  p_request_id uuid,
  p_user_content text,
  p_assistant_content text
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
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_request_id is null
     or nullif(btrim(p_user_content), '') is null
     or nullif(btrim(p_assistant_content), '') is null then
    raise exception using errcode = '23514', message = 'A complete non-empty turn is required.';
  end if;

  -- Serialize duplicate retries for the same logical turn without holding a
  -- broad table lock.
  perform pg_advisory_xact_lock(
    hashtextextended(p_thread_id::text || ':' || p_request_id::text, 0)
  );

  if not exists (
    select 1
    from public.agent_threads as thread
    join public.project_members as membership
      on membership.project_id = thread.project_id
     and membership.user_id = caller_id
    where thread.id = p_thread_id
      and thread.user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Thread access denied.';
  end if;

  select message.*
  into user_row
  from public.messages as message
  where message.thread_id = p_thread_id
    and message.request_id = p_request_id
    and message.role = 'user';

  select message.*
  into assistant_row
  from public.messages as message
  where message.thread_id = p_thread_id
    and message.request_id = p_request_id
    and message.role = 'assistant';

  if user_row.id is not null and assistant_row.id is not null then
    return jsonb_build_object(
      'userMessage', jsonb_build_object(
        'id', user_row.id,
        'role', user_row.role,
        'content', user_row.content,
        'createdAt', user_row.created_at
      ),
      'assistantMessage', jsonb_build_object(
        'id', assistant_row.id,
        'role', assistant_row.role,
        'content', assistant_row.content,
        'createdAt', assistant_row.created_at
      )
    );
  end if;

  if user_row.id is not null or assistant_row.id is not null then
    raise exception using errcode = '23514', message = 'Incomplete stored turn.';
  end if;

  insert into public.messages (thread_id, request_id, role, content)
  values (p_thread_id, p_request_id, 'user', btrim(p_user_content))
  returning * into user_row;

  insert into public.messages (thread_id, request_id, role, content)
  values (p_thread_id, p_request_id, 'assistant', btrim(p_assistant_content))
  returning * into assistant_row;

  update public.agent_threads
  set updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object(
    'userMessage', jsonb_build_object(
      'id', user_row.id,
      'role', user_row.role,
      'content', user_row.content,
      'createdAt', user_row.created_at
    ),
    'assistantMessage', jsonb_build_object(
      'id', assistant_row.id,
      'role', assistant_row.role,
      'content', assistant_row.content,
      'createdAt', assistant_row.created_at
    )
  );
end;
$$;

revoke all on function public.append_agent_turn(uuid, uuid, text, text) from public, anon;
grant execute on function public.append_agent_turn(uuid, uuid, text, text) to authenticated;

comment on function public.append_agent_turn(uuid, uuid, text, text)
  is 'Atomically and idempotently appends one completed user/assistant agent turn.';

commit;
