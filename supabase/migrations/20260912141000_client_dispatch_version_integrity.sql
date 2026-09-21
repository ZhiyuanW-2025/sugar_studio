begin;

alter table public.client_delivery_dispatches
  drop constraint client_delivery_dispatches_version_id_fkey,
  add constraint client_delivery_dispatches_version_same_document_fkey
  foreign key (version_id, deliverable_id)
  references public.client_deliverable_versions (id, deliverable_id)
  on delete restrict;

commit;
