alter table public.marketing_contents
  add column if not exists publish_account text not null default '',
  add column if not exists scheduled_at timestamptz,
  add column if not exists completed_at timestamptz;

create table if not exists public.marketing_content_images (
  id uuid primary key default gen_random_uuid(),
  marketing_content_id uuid not null references public.marketing_contents(id) on delete cascade,
  image_generation_id uuid references public.image_generations(id) on delete cascade,
  storage_path text,
  file_name text not null,
  mime_type text not null default 'image/*',
  source text not null default 'user_upload' check (source in ('user_upload','xiaoxiong_generated')),
  is_official boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint marketing_content_images_one_source check ((image_generation_id is null) <> (storage_path is null))
);

create unique index if not exists marketing_content_images_generation_unique
  on public.marketing_content_images(marketing_content_id, image_generation_id)
  where image_generation_id is not null;
create index if not exists marketing_content_images_content_idx
  on public.marketing_content_images(marketing_content_id, created_at desc);

alter table public.marketing_content_images enable row level security;
grant select, insert, update, delete on public.marketing_content_images to authenticated;

create policy marketing_content_images_select on public.marketing_content_images
for select to authenticated using (
  exists (select 1 from public.marketing_contents c join public.project_members pm on pm.project_id = c.project_id
    where c.id = marketing_content_id and pm.user_id = auth.uid())
);
create policy marketing_content_images_insert on public.marketing_content_images
for insert to authenticated with check (
  created_by = auth.uid() and exists (select 1 from public.marketing_contents c join public.project_members pm on pm.project_id = c.project_id
    where c.id = marketing_content_id and pm.user_id = auth.uid())
);
create policy marketing_content_images_update on public.marketing_content_images
for update to authenticated using (
  exists (select 1 from public.marketing_contents c join public.project_members pm on pm.project_id = c.project_id
    where c.id = marketing_content_id and pm.user_id = auth.uid())
) with check (created_by = auth.uid());
create policy marketing_content_images_delete on public.marketing_content_images
for delete to authenticated using (
  exists (select 1 from public.marketing_contents c join public.project_members pm on pm.project_id = c.project_id
    where c.id = marketing_content_id and pm.user_id = auth.uid())
);
