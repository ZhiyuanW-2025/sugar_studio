-- Feishu knowledge files may be larger than the interactive upload limit.
-- The application still enforces its own smaller limit for ordinary uploads.
update storage.buckets
set file_size_limit = 104857600
where id in ('project-files', 'company-knowledge');
