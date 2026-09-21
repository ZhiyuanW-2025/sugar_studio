begin;

alter table public.procurement_inquiry_targets
  add column follow_up_status text not null default 'active'
    check (follow_up_status in ('active', 'ended')),
  add column follow_up_ended_at timestamptz,
  add column has_new_reply boolean not null default false,
  add column last_message_at timestamptz,
  add column last_checked_at timestamptz;

create index procurement_inquiry_targets_active_follow_up_idx
  on public.procurement_inquiry_targets(follow_up_status, last_checked_at)
  where follow_up_status = 'active';

comment on column public.procurement_inquiry_targets.follow_up_status is
  'Sugar Agent follow-up lifecycle, independent from the finite Newton inquiry task lifecycle.';
comment on column public.procurement_inquiry_targets.has_new_reply is
  'Set when a sync discovers a new seller message; cleared when a project member opens the record.';

commit;
