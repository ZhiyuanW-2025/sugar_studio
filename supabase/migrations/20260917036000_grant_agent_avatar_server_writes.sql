begin;

grant select, update on table public.agents to service_role;
grant select, insert on table public.agent_config_activities to service_role;

commit;
