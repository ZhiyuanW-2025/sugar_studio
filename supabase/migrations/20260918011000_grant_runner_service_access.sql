begin;

grant select, insert, update, delete on table public.runner_devices to service_role;
grant select, insert, update, delete on table public.runner_pairing_codes to service_role;
grant select, insert, update, delete on table public.runner_jobs to service_role;

commit;
