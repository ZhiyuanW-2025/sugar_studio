begin;

drop policy if exists procurement_inquiries_insert_members on public.procurement_inquiries;
drop policy if exists procurement_inquiries_update_members on public.procurement_inquiries;
drop policy if exists procurement_inquiries_delete_members on public.procurement_inquiries;
drop policy if exists procurement_inquiry_targets_insert_members on public.procurement_inquiry_targets;
drop policy if exists procurement_inquiry_targets_update_members on public.procurement_inquiry_targets;
drop policy if exists procurement_inquiry_targets_delete_members on public.procurement_inquiry_targets;
drop policy if exists procurement_inquiry_messages_insert_members on public.procurement_inquiry_messages;
drop policy if exists procurement_inquiry_messages_update_members on public.procurement_inquiry_messages;
drop policy if exists procurement_inquiry_messages_delete_members on public.procurement_inquiry_messages;

revoke insert, update, delete on table public.procurement_inquiries,
  public.procurement_inquiry_targets, public.procurement_inquiry_messages from authenticated;

comment on table public.procurement_inquiries is
  'Project members may read inquiries through RLS. Only authenticated server endpoints using service_role may create or mutate external inquiry state.';

commit;
