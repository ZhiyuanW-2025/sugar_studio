begin;

create table public.design_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint design_assets_name_not_blank check (length(btrim(file_name)) > 0),
  constraint design_assets_mime_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint design_assets_size_check check (size_bytes > 0 and size_bytes <= 26214400)
);

create index design_assets_project_created_idx
  on public.design_assets(project_id, created_at desc);

alter table public.design_assets enable row level security;
revoke all on table public.design_assets from anon, authenticated;
grant select on table public.design_assets to authenticated;

create policy design_assets_select_members
on public.design_assets for select to authenticated
using (private.is_project_member(project_id));

grant select, insert, delete on table public.design_assets to service_role;

alter table public.image_generations
  drop constraint image_generations_source_choice_check,
  add column source_feishu_drive_item_id uuid references public.feishu_drive_items(id) on delete set null,
  add column source_design_asset_id uuid references public.design_assets(id) on delete set null,
  add column source_refs jsonb not null default '[]'::jsonb,
  add column batch_id uuid,
  add column batch_index integer not null default 0,
  add constraint image_generations_source_choice_check
    check (num_nonnulls(source_generation_id, source_project_file_id, source_feishu_drive_item_id, source_design_asset_id) <= 1),
  add constraint image_generations_batch_index_check check (batch_index >= 0 and batch_index < 4);

create index image_generations_batch_idx
  on public.image_generations(batch_id, batch_index)
  where batch_id is not null;

create index image_generations_source_feishu_drive_idx
  on public.image_generations(source_feishu_drive_item_id)
  where source_feishu_drive_item_id is not null;

create index image_generations_source_design_asset_idx
  on public.image_generations(source_design_asset_id)
  where source_design_asset_id is not null;

comment on table public.design_assets is
  'Temporary private image references uploaded from outside a project for design chat and image editing.';
comment on column public.image_generations.batch_id is
  'Groups one user image request that intentionally produced multiple outputs.';
comment on column public.image_generations.source_refs is
  'Authorized visual references used by a generation; private bytes remain in Feishu or Storage.';

commit;
