begin;

alter table public.image_generations
  add column operation text not null default 'generate',
  add column source_generation_id uuid references public.image_generations (id) on delete set null,
  add column source_project_file_id uuid references public.project_files (id) on delete set null,
  add column source_storage_path text,
  add column source_mime_type text,
  add constraint image_generations_operation_check
    check (operation in ('generate', 'edit')),
  add constraint image_generations_source_choice_check
    check (num_nonnulls(source_generation_id, source_project_file_id) <= 1),
  add constraint image_generations_generate_source_check
    check (
      operation = 'edit'
      or (
        source_generation_id is null
        and source_project_file_id is null
        and source_storage_path is null
        and source_mime_type is null
      )
    ),
  add constraint image_generations_completed_edit_source_check
    check (
      operation = 'generate'
      or status <> 'completed'
      or (
        source_storage_path is not null
        and source_mime_type in ('image/png', 'image/jpeg', 'image/webp')
      )
    );

create index image_generations_source_generation_idx
  on public.image_generations (source_generation_id)
  where source_generation_id is not null;

create index image_generations_source_project_file_idx
  on public.image_generations (source_project_file_id)
  where source_project_file_id is not null;

comment on column public.image_generations.operation is
  'generate creates a new image; edit derives an image from one authorized project source.';
comment on column public.image_generations.source_storage_path is
  'Stable private source path used for an edit. Project file sources are snapshotted into agent-images.';

commit;
