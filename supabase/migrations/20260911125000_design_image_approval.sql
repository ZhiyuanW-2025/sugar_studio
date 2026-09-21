begin;

alter table public.image_generations
  add column review_status text not null default 'draft',
  add column approved_by uuid references auth.users (id) on delete set null,
  add column approved_at timestamptz,
  add constraint image_generations_review_status_check
    check (review_status in ('draft', 'approved')),
  add constraint image_generations_approval_consistency_check
    check (
      (review_status = 'draft' and approved_by is null and approved_at is null)
      or (review_status = 'approved' and approved_at is not null)
    );

create index image_generations_project_review_created_idx
  on public.image_generations (project_id, review_status, created_at desc);

create function public.set_image_generation_approval(
  p_project_id uuid,
  p_generation_id uuid,
  p_approved boolean
)
returns table (
  review_status text,
  approved_by uuid,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_generation public.image_generations%rowtype;
  v_actor text;
begin
  if v_caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.project_members as membership
    where membership.project_id = p_project_id
      and membership.user_id = v_caller_id
  ) then
    raise exception 'Project membership required.' using errcode = '42501';
  end if;

  select generation.* into v_generation
  from public.image_generations as generation
  where generation.id = p_generation_id
    and generation.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Image generation not found.' using errcode = 'P0002';
  end if;

  if v_generation.status <> 'completed' then
    raise exception 'Only completed images can be approved.' using errcode = '23514';
  end if;

  if (v_generation.review_status = 'approved') = p_approved then
    review_status := v_generation.review_status;
    approved_by := v_generation.approved_by;
    approved_at := v_generation.approved_at;
    return next;
    return;
  end if;

  update public.image_generations as generation
  set
    review_status = case when p_approved then 'approved' else 'draft' end,
    approved_by = case when p_approved then v_caller_id else null end,
    approved_at = case when p_approved then now() else null end
  where generation.id = p_generation_id
  returning generation.review_status, generation.approved_by, generation.approved_at
  into review_status, approved_by, approved_at;

  select coalesce(nullif(btrim(profile.display_name), ''), '项目成员')
  into v_actor
  from public.profiles as profile
  where profile.id = v_caller_id;

  insert into public.project_activities (
    project_id,
    user_id,
    event_type,
    actor_type,
    actor,
    summary,
    related_entity_id
  ) values (
    p_project_id,
    v_caller_id,
    case when p_approved then 'design_image_approved' else 'design_image_approval_revoked' end,
    'user',
    coalesce(v_actor, '项目成员'),
    case when p_approved then '确认了一张项目视觉成果' else '撤回了一张项目视觉成果的确认' end,
    p_generation_id
  );

  return next;
end;
$$;

revoke execute on function public.set_image_generation_approval(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_image_generation_approval(uuid, uuid, boolean)
  to authenticated;

comment on column public.image_generations.review_status is
  'Project review state. Generated and edited images remain draft until a project member approves them.';
comment on function public.set_image_generation_approval(uuid, uuid, boolean) is
  'Allows any project member to approve or revoke a completed project image and records the activity.';

commit;
