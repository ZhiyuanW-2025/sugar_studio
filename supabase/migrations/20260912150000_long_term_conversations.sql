begin;

create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  is_current boolean not null default true,
  summary text not null default '',
  summarized_message_count integer not null default 0 check (summarized_message_count >= 0),
  codex_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index agent_conversations_one_current_idx on public.agent_conversations (thread_id) where is_current and status = 'active';
create unique index agent_conversations_codex_thread_id_key on public.agent_conversations (codex_thread_id) where codex_thread_id is not null;
create index agent_conversations_thread_updated_idx on public.agent_conversations (thread_id, updated_at desc);

insert into public.agent_conversations (thread_id, title, codex_thread_id, created_at, updated_at)
select id, title, codex_thread_id, created_at, updated_at from public.agent_threads;

create function private.create_initial_agent_conversation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.agent_conversations(thread_id, title, codex_thread_id)
  values(new.id, new.title, new.codex_thread_id);
  return new;
end;
$$;
create trigger agent_threads_create_initial_conversation after insert on public.agent_threads
for each row execute function private.create_initial_agent_conversation();

alter table public.messages add column conversation_id uuid references public.agent_conversations (id) on delete cascade;
update public.messages message set conversation_id = conversation.id
from public.agent_conversations conversation where conversation.thread_id = message.thread_id;

create function private.set_message_current_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_id is null then
    select id into new.conversation_id from public.agent_conversations
    where thread_id = new.thread_id and is_current and status = 'active';
  end if;
  if new.conversation_id is null or not exists (
    select 1 from public.agent_conversations where id = new.conversation_id and thread_id = new.thread_id
  ) then
    raise exception using errcode = '23514', message = 'Message conversation does not belong to thread.';
  end if;
  return new;
end;
$$;

create trigger messages_set_current_conversation before insert or update of thread_id, conversation_id on public.messages
for each row execute function private.set_message_current_conversation();
alter table public.messages alter column conversation_id set not null;
alter table public.messages add column search_vector tsvector generated always as (to_tsvector('simple', content)) stored;
create index messages_conversation_created_idx on public.messages (conversation_id, created_at, id);
create index messages_search_vector_idx on public.messages using gin (search_vector);
create index messages_content_trgm_idx on public.messages using gin (content extensions.gin_trgm_ops);

create trigger agent_conversations_set_updated_at before update on public.agent_conversations
for each row execute function public.set_sugar_agent_updated_at();

alter table public.agent_conversations enable row level security;
revoke all on table public.agent_conversations from anon, authenticated;
grant select, insert, update, delete on table public.agent_conversations to authenticated;
grant select, insert, update, delete on table public.agent_conversations to service_role;

create policy agent_conversations_select_own on public.agent_conversations for select to authenticated using (exists (
  select 1 from public.agent_threads thread where thread.id = agent_conversations.thread_id
    and thread.user_id = (select auth.uid()) and private.is_project_member(thread.project_id)
));
create policy agent_conversations_insert_own on public.agent_conversations for insert to authenticated with check (exists (
  select 1 from public.agent_threads thread where thread.id = agent_conversations.thread_id
    and thread.user_id = (select auth.uid()) and private.is_project_member(thread.project_id)
));
create policy agent_conversations_update_own on public.agent_conversations for update to authenticated using (exists (
  select 1 from public.agent_threads thread where thread.id = agent_conversations.thread_id
    and thread.user_id = (select auth.uid()) and private.is_project_member(thread.project_id)
)) with check (exists (
  select 1 from public.agent_threads thread where thread.id = agent_conversations.thread_id
    and thread.user_id = (select auth.uid()) and private.is_project_member(thread.project_id)
));
create policy agent_conversations_delete_own on public.agent_conversations for delete to authenticated using (exists (
  select 1 from public.agent_threads thread where thread.id = agent_conversations.thread_id
    and thread.user_id = (select auth.uid()) and private.is_project_member(thread.project_id)
));

create function public.create_agent_conversation(p_thread_id uuid, p_title text default '新对话')
returns public.agent_conversations
language plpgsql security definer set search_path = ''
as $$
declare caller_id uuid := (select auth.uid()); result public.agent_conversations%rowtype;
begin
  if caller_id is null or not exists (
    select 1 from public.agent_threads thread where thread.id = p_thread_id and thread.user_id = caller_id
      and private.is_project_member(thread.project_id)
  ) then raise exception using errcode='42501', message='Thread access denied.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_thread_id::text || ':current-conversation', 0));
  update public.agent_conversations set is_current = false where thread_id = p_thread_id and is_current;
  insert into public.agent_conversations(thread_id, title) values (p_thread_id, coalesce(nullif(btrim(p_title),''),'新对话')) returning * into result;
  return result;
end;
$$;

create function public.set_current_agent_conversation(p_conversation_id uuid)
returns public.agent_conversations
language plpgsql security definer set search_path = ''
as $$
declare caller_id uuid := (select auth.uid()); result public.agent_conversations%rowtype;
begin
  select conversation.* into result from public.agent_conversations conversation
  join public.agent_threads thread on thread.id = conversation.thread_id
  where conversation.id = p_conversation_id and conversation.status = 'active' and thread.user_id = caller_id
    and private.is_project_member(thread.project_id) for update of conversation;
  if not found then raise exception using errcode='42501', message='Conversation access denied.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(result.thread_id::text || ':current-conversation', 0));
  update public.agent_conversations set is_current = (id = result.id) where thread_id = result.thread_id and status = 'active';
  select * into result from public.agent_conversations where id = result.id;
  return result;
end;
$$;

create function public.update_agent_conversation(p_conversation_id uuid, p_title text, p_archive boolean default false)
returns public.agent_conversations
language plpgsql security definer set search_path = ''
as $$
declare caller_id uuid := (select auth.uid()); result public.agent_conversations%rowtype; replacement_id uuid;
begin
  select conversation.* into result from public.agent_conversations conversation
  join public.agent_threads thread on thread.id = conversation.thread_id
  where conversation.id = p_conversation_id and thread.user_id = caller_id and private.is_project_member(thread.project_id)
  for update of conversation;
  if not found then raise exception using errcode='42501', message='Conversation access denied.'; end if;
  if p_archive then
    update public.agent_conversations set status='archived', is_current=false where id=result.id;
    if result.is_current then
      select id into replacement_id from public.agent_conversations where thread_id=result.thread_id and status='active' and id<>result.id order by updated_at desc limit 1;
      if replacement_id is null then
        insert into public.agent_conversations(thread_id,title) values(result.thread_id,'新对话') returning id into replacement_id;
      else update public.agent_conversations set is_current=true where id=replacement_id; end if;
    end if;
  else
    if nullif(btrim(p_title),'') is null then raise exception using errcode='23514', message='Title is required.'; end if;
    update public.agent_conversations set title=btrim(p_title) where id=result.id;
  end if;
  select * into result from public.agent_conversations where id=result.id;
  return result;
end;
$$;

create function public.append_agent_turn(
  p_thread_id uuid, p_conversation_id uuid, p_request_id uuid, p_user_content text, p_assistant_content text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare caller_id uuid := (select auth.uid()); user_row public.messages%rowtype; assistant_row public.messages%rowtype;
begin
  if caller_id is null or p_request_id is null or nullif(btrim(p_user_content),'') is null or nullif(btrim(p_assistant_content),'') is null then
    raise exception using errcode='23514', message='A complete authenticated turn is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text || ':' || p_request_id::text, 0));
  if not exists (select 1 from public.agent_conversations conversation join public.agent_threads thread on thread.id=conversation.thread_id
    where conversation.id=p_conversation_id and conversation.thread_id=p_thread_id and conversation.status='active'
      and thread.user_id=caller_id and private.is_project_member(thread.project_id)) then
    raise exception using errcode='42501', message='Conversation access denied.';
  end if;
  select * into user_row from public.messages where conversation_id=p_conversation_id and request_id=p_request_id and role='user';
  select * into assistant_row from public.messages where conversation_id=p_conversation_id and request_id=p_request_id and role='assistant';
  if user_row.id is not null and assistant_row.id is not null then
    return jsonb_build_object('userMessage',jsonb_build_object('id',user_row.id,'role',user_row.role,'content',user_row.content,'createdAt',user_row.created_at),'assistantMessage',jsonb_build_object('id',assistant_row.id,'role',assistant_row.role,'content',assistant_row.content,'createdAt',assistant_row.created_at));
  end if;
  if user_row.id is not null or assistant_row.id is not null then raise exception using errcode='23514',message='Incomplete stored turn.'; end if;
  insert into public.messages(thread_id,conversation_id,request_id,role,content) values(p_thread_id,p_conversation_id,p_request_id,'user',btrim(p_user_content)) returning * into user_row;
  insert into public.messages(thread_id,conversation_id,request_id,role,content) values(p_thread_id,p_conversation_id,p_request_id,'assistant',btrim(p_assistant_content)) returning * into assistant_row;
  update public.agent_conversations set updated_at=now() where id=p_conversation_id;
  update public.agent_threads set updated_at=now() where id=p_thread_id;
  return jsonb_build_object('userMessage',jsonb_build_object('id',user_row.id,'role',user_row.role,'content',user_row.content,'createdAt',user_row.created_at),'assistantMessage',jsonb_build_object('id',assistant_row.id,'role',assistant_row.role,'content',assistant_row.content,'createdAt',assistant_row.created_at));
end;
$$;

create function public.search_agent_conversations(p_project_id uuid, p_agent_type text, p_query text, p_limit integer default 20)
returns table(conversation_id uuid, conversation_title text, message_id uuid, role text, content text, created_at timestamptz, rank real)
language sql stable security definer set search_path = ''
as $$
  select conversation.id, conversation.title, message.id, message.role, message.content, message.created_at,
    greatest(ts_rank_cd(message.search_vector, plainto_tsquery('simple', p_query)), extensions.similarity(message.content, p_query))::real
  from public.messages message join public.agent_conversations conversation on conversation.id=message.conversation_id
  join public.agent_threads thread on thread.id=conversation.thread_id
  where (select auth.uid())=thread.user_id and private.is_project_member(thread.project_id)
    and thread.project_id=p_project_id and thread.agent_type=p_agent_type and length(btrim(p_query))>0
    and (message.search_vector @@ plainto_tsquery('simple', p_query) or message.content ilike '%'||p_query||'%' or extensions.similarity(message.content,p_query)>0.1)
  order by 7 desc, message.created_at desc limit least(greatest(p_limit,1),50);
$$;

revoke all on function public.create_agent_conversation(uuid,text), public.set_current_agent_conversation(uuid), public.update_agent_conversation(uuid,text,boolean), public.append_agent_turn(uuid,uuid,uuid,text,text), public.search_agent_conversations(uuid,text,text,integer) from public, anon;
grant execute on function public.create_agent_conversation(uuid,text), public.set_current_agent_conversation(uuid), public.update_agent_conversation(uuid,text,boolean), public.append_agent_turn(uuid,uuid,uuid,text,text), public.search_agent_conversations(uuid,text,text,integer) to authenticated;

comment on table public.agent_threads is 'Stable user + project + Agent work lane; multiple conversations live beneath it.';
comment on table public.agent_conversations is 'User-managed long-term conversations, summaries, and provider session identifiers.';

commit;
