begin;

alter table public.handoff_tasks
  add column brief_type text,
  add column brief jsonb;

update public.handoff_tasks as task
set
  brief_type = case task.target_agent when 'coding' then 'technical' else 'visual' end,
  brief = case task.target_agent
    when 'coding' then jsonb_build_object(
      'title', task.title,
      'goal', task.title,
      'background', task.content,
      'requirements', jsonb_build_array(task.content),
      'constraints', '[]'::jsonb,
      'unchanged_scope', '[]'::jsonb,
      'acceptance_criteria', '[]'::jsonb,
      'related_project', project.name,
      'source_plan_version', case when task.source_plan_version is null then null else to_jsonb(task.source_plan_version::text) end
    )
    else jsonb_build_object(
      'title', task.title,
      'goal', task.title,
      'usage', '历史交接任务，使用场景未结构化',
      'content_requirements', jsonb_build_array(task.content),
      'visual_direction', '[]'::jsonb,
      'required_elements', '[]'::jsonb,
      'forbidden_elements', '[]'::jsonb,
      'size_or_medium', '历史交接任务，尺寸或媒介未记录',
      'references', '[]'::jsonb,
      'related_project', project.name,
      'source_plan_version', case when task.source_plan_version is null then null else to_jsonb(task.source_plan_version::text) end
    )
  end
from public.projects as project
where project.id = task.project_id;

alter table public.handoff_tasks
  alter column brief_type set not null,
  alter column brief set not null,
  add constraint handoff_tasks_brief_type_check
    check (brief_type in ('technical', 'visual')),
  add constraint handoff_tasks_brief_matches_target_check
    check (
      (target_agent = 'coding' and brief_type = 'technical')
      or (target_agent = 'design' and brief_type = 'visual')
    );

create function private.is_text_array(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(value) as element
      where jsonb_typeof(element) <> 'string' or length(btrim(element #>> '{}')) = 0
    );
$$;

create function private.is_valid_handoff_brief(p_brief_type text, p_brief jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_brief) = 'object'
    and nullif(btrim(p_brief->>'title'), '') is not null
    and nullif(btrim(p_brief->>'goal'), '') is not null
    and nullif(btrim(p_brief->>'related_project'), '') is not null
    and (p_brief ? 'source_plan_version')
    and case p_brief_type
      when 'technical' then
        nullif(btrim(p_brief->>'background'), '') is not null
        and private.is_text_array(p_brief->'requirements')
        and private.is_text_array(p_brief->'constraints')
        and private.is_text_array(p_brief->'unchanged_scope')
        and private.is_text_array(p_brief->'acceptance_criteria')
      when 'visual' then
        nullif(btrim(p_brief->>'usage'), '') is not null
        and private.is_text_array(p_brief->'content_requirements')
        and private.is_text_array(p_brief->'visual_direction')
        and private.is_text_array(p_brief->'required_elements')
        and private.is_text_array(p_brief->'forbidden_elements')
        and nullif(btrim(p_brief->>'size_or_medium'), '') is not null
        and private.is_text_array(p_brief->'references')
      else false
    end;
$$;

alter table public.handoff_tasks
  add constraint handoff_tasks_valid_brief_check
    check (private.is_valid_handoff_brief(brief_type, brief)),
  add constraint handoff_tasks_title_matches_brief_check
    check (title = brief->>'title');

create function private.render_handoff_brief(p_brief_type text, p_brief jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_item text;
begin
  v_text := case p_brief_type when 'technical' then 'Technical Brief' else 'Visual Brief' end
    || E'\n\n标题（title）：\n' || p_brief->>'title'
    || E'\n\n目标（goal）：\n' || p_brief->>'goal';

  if p_brief_type = 'technical' then
    v_text := v_text || E'\n\n背景（background）：\n' || p_brief->>'background';
    foreach v_item in array array['requirements', 'constraints', 'unchanged_scope', 'acceptance_criteria'] loop
      v_text := v_text || E'\n\n' || v_item || E'：\n'
        || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->v_item)), '（无）');
    end loop;
  else
    v_text := v_text || E'\n\n使用场景（usage）：\n' || p_brief->>'usage';
    foreach v_item in array array['content_requirements', 'visual_direction', 'required_elements', 'forbidden_elements'] loop
      v_text := v_text || E'\n\n' || v_item || E'：\n'
        || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->v_item)), '（无）');
    end loop;
    v_text := v_text || E'\n\n尺寸或媒介（size_or_medium）：\n' || p_brief->>'size_or_medium'
      || E'\n\nreferences：\n'
      || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->'references')), '（无）');
  end if;

  return v_text
    || E'\n\n相关项目（related_project）：\n' || p_brief->>'related_project'
    || E'\n\n来源正式方案版本（source_plan_version）：\n' || coalesce(p_brief->>'source_plan_version', '未关联');
end;
$$;

drop function public.deliver_handoff_idempotently(uuid, uuid, text, text);
drop function public.approve_and_deliver_handoff(uuid, uuid, text, text);
drop function public.create_handoff_draft(uuid, uuid, text, uuid, text, text);

create function public.create_handoff_draft(
  p_project_id uuid,
  p_source_thread_id uuid,
  p_target_agent text,
  p_source_plan_version uuid,
  p_brief jsonb
)
returns public.handoff_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_result public.handoff_tasks%rowtype;
  v_brief_type text;
  v_project_name text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;
  if p_target_agent not in ('coding', 'design') then
    raise exception using errcode = '23514', message = 'Invalid handoff target.';
  end if;
  if not exists (
    select 1 from public.agent_threads
    where id = p_source_thread_id
      and project_id = p_project_id
      and user_id = caller_id
      and agent_type = 'planning'
  ) then
    raise exception using errcode = '42501', message = 'Source thread access denied.';
  end if;
  if p_source_plan_version is not null and not exists (
    select 1 from public.artifact_versions as version
    join public.artifacts as artifact on artifact.id = version.artifact_id
    where version.id = p_source_plan_version and artifact.project_id = p_project_id
  ) then
    raise exception using errcode = '42501', message = 'Plan version access denied.';
  end if;

  select name into strict v_project_name from public.projects where id = p_project_id;
  v_brief_type := case p_target_agent when 'coding' then 'technical' else 'visual' end;
  p_brief := jsonb_set(p_brief, '{related_project}', to_jsonb(v_project_name), true);
  p_brief := jsonb_set(
    p_brief,
    '{source_plan_version}',
    case when p_source_plan_version is null then 'null'::jsonb else to_jsonb(p_source_plan_version::text) end,
    true
  );
  if not private.is_valid_handoff_brief(v_brief_type, p_brief) then
    raise exception using errcode = '23514', message = 'Invalid structured handoff brief.';
  end if;

  insert into public.handoff_tasks (
    project_id, source_agent, target_agent, source_thread_id, source_plan_version,
    title, content, brief_type, brief, status, created_by
  ) values (
    p_project_id, 'planning', p_target_agent, p_source_thread_id, p_source_plan_version,
    btrim(p_brief->>'title'), private.render_handoff_brief(v_brief_type, p_brief),
    v_brief_type, p_brief, 'draft', caller_id
  ) returning * into v_result;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values (
    p_project_id, caller_id, 'handoff_task_created', 'agent', '策划师小花',
    format('为%s创建了结构化交接任务草稿：%s', case p_target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end, v_result.title),
    v_result.id
  );

  return v_result;
end;
$$;

create function public.approve_and_deliver_handoff(
  p_project_id uuid,
  p_handoff_id uuid,
  p_brief jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_task public.handoff_tasks%rowtype;
  v_thread public.agent_threads%rowtype;
  v_actor text;
  v_target_name text;
  v_message text;
  v_content text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select * into v_task from public.handoff_tasks
  where id = p_handoff_id and project_id = p_project_id
  for update;
  if not found or v_task.created_by <> caller_id then
    raise exception using errcode = '42501', message = 'Handoff access denied.';
  end if;
  if v_task.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Handoff was already processed.';
  end if;

  p_brief := jsonb_set(p_brief, '{related_project}', v_task.brief->'related_project', true);
  p_brief := jsonb_set(p_brief, '{source_plan_version}', v_task.brief->'source_plan_version', true);
  if not private.is_valid_handoff_brief(v_task.brief_type, p_brief) then
    raise exception using errcode = '23514', message = 'Invalid structured handoff brief.';
  end if;
  v_content := private.render_handoff_brief(v_task.brief_type, p_brief);

  update public.handoff_tasks
  set title = btrim(p_brief->>'title'), content = v_content, brief = p_brief,
      status = 'approved', approved_at = now()
  where id = v_task.id;

  insert into public.agent_threads (project_id, user_id, agent_type, title)
  values (
    p_project_id, caller_id, v_task.target_agent,
    case v_task.target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end
  )
  on conflict (user_id, project_id, agent_type)
  do update set updated_at = now()
  returning * into v_thread;

  v_target_name := case v_task.target_agent when 'coding' then '工程师牛牛' else '艺术家小熊' end;
  v_message := format('【来自策划师小花的已确认%s】\n\n%s', case v_task.brief_type when 'technical' then 'Technical Brief' else 'Visual Brief' end, v_content);

  insert into public.messages (thread_id, request_id, role, content)
  values (v_thread.id, v_task.id, 'system', v_message);

  update public.handoff_tasks
  set status = 'delivered', target_thread_id = v_thread.id, delivered_at = now()
  where id = v_task.id;

  update public.agent_threads set updated_at = now() where id = v_thread.id;

  select coalesce(nullif(btrim(display_name), ''), '项目成员') into v_actor
  from public.profiles where id = caller_id;

  insert into public.project_activities (
    project_id, user_id, event_type, actor_type, actor, summary, related_entity_id
  ) values
    (p_project_id, caller_id, 'handoff_task_approved', 'user', coalesce(v_actor, '项目成员'), format('批准了结构化交接任务：%s', p_brief->>'title'), v_task.id),
    (p_project_id, caller_id, 'handoff_task_delivered', 'user', coalesce(v_actor, '项目成员'), format('将任务发送给%s：%s', v_target_name, p_brief->>'title'), v_task.id);

  return jsonb_build_object(
    'taskId', v_task.id,
    'targetAgent', v_task.target_agent,
    'targetThreadId', v_thread.id,
    'briefType', v_task.brief_type,
    'brief', p_brief,
    'title', p_brief->>'title',
    'content', v_content,
    'message', v_message
  );
end;
$$;

create function public.deliver_handoff_idempotently(
  p_project_id uuid,
  p_handoff_id uuid,
  p_brief jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  v_task public.handoff_tasks%rowtype;
  v_message text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'Project access denied.';
  end if;

  select * into v_task from public.handoff_tasks
  where id = p_handoff_id and project_id = p_project_id;
  if not found or v_task.created_by <> caller_id then
    raise exception using errcode = '42501', message = 'Handoff access denied.';
  end if;

  if v_task.status = 'delivered' then
    select content into v_message from public.messages
    where thread_id = v_task.target_thread_id
      and request_id = v_task.id
      and role = 'system';
    return jsonb_build_object(
      'taskId', v_task.id,
      'targetAgent', v_task.target_agent,
      'targetThreadId', v_task.target_thread_id,
      'briefType', v_task.brief_type,
      'brief', v_task.brief,
      'title', v_task.title,
      'content', v_task.content,
      'message', v_message,
      'replayed', true
    );
  end if;

  return public.approve_and_deliver_handoff(p_project_id, p_handoff_id, p_brief)
    || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.create_handoff_draft(uuid, uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.approve_and_deliver_handoff(uuid, uuid, jsonb) from public, anon;
revoke all on function public.deliver_handoff_idempotently(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_handoff_draft(uuid, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.approve_and_deliver_handoff(uuid, uuid, jsonb) to authenticated;
grant execute on function public.deliver_handoff_idempotently(uuid, uuid, jsonb) to authenticated;

comment on column public.handoff_tasks.brief is 'Validated Technical Brief or Visual Brief edited and approved by the user before delivery.';
comment on function public.create_handoff_draft(uuid, uuid, text, uuid, jsonb) is 'Creates a validated structured draft without delivering it.';
comment on function public.deliver_handoff_idempotently(uuid, uuid, jsonb) is 'User-confirmed, retry-safe delivery of an edited structured brief.';

commit;
