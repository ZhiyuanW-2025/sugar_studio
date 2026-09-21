grant select, insert, update, delete on table public.project_files to service_role;

comment on table public.project_files is
  'Project source files. Service-role access is required by server-only knowledge retrieval and Feishu mirroring.';
