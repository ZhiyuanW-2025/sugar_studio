begin;

-- The Data API requires SQL privileges in addition to RLS bypass. Only the
-- trusted server client receives write access to generation jobs.
grant select, insert, update on table public.image_generations to service_role;
grant select on table public.image_model_preferences to service_role;
grant insert on table public.project_activities to service_role;

commit;
