alter table public.agent_threads
  add column codex_thread_id text;

alter table public.agent_threads
  add constraint agent_threads_codex_thread_is_coding
  check (codex_thread_id is null or agent_type = 'coding');

create unique index agent_threads_codex_thread_id_key
  on public.agent_threads (codex_thread_id)
  where codex_thread_id is not null;

comment on column public.agent_threads.codex_thread_id is
  'Server-managed Codex SDK thread used by the coding conversation and resumed for explicit execution.';
