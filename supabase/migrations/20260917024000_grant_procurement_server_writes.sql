begin;

-- Procurement mutations are intentionally performed only by authenticated
-- server endpoints. RLS bypass alone is not enough: the service role also
-- needs explicit table privileges after the tables were created.
grant select, insert, update, delete
on table public.project_procurement_candidates
to service_role;

grant select, insert, update, delete
on table public.procurement_inquiries,
  public.procurement_inquiry_targets,
  public.procurement_inquiry_messages
to service_role;

commit;
