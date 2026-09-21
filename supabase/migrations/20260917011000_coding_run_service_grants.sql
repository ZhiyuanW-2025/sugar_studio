begin;

-- Server-side runner persistence uses the Supabase secret role after the
-- authenticated RPC creates a run. RLS bypass alone does not supply table
-- privileges after the earlier explicit revoke.
grant select, update on table public.coding_runs to service_role;

commit;
