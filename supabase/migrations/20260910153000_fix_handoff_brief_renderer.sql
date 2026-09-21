begin;

create or replace function private.render_handoff_brief(p_brief_type text, p_brief jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_item text;
begin
  v_text := (case p_brief_type when 'technical' then 'Technical Brief' else 'Visual Brief' end)
    || E'\n\n标题（title）：\n' || (p_brief->>'title')
    || E'\n\n目标（goal）：\n' || (p_brief->>'goal');

  if p_brief_type = 'technical' then
    v_text := v_text || E'\n\n背景（background）：\n' || (p_brief->>'background');
    foreach v_item in array array['requirements', 'constraints', 'unchanged_scope', 'acceptance_criteria'] loop
      v_text := v_text || E'\n\n' || v_item || E'：\n'
        || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->v_item)), '（无）');
    end loop;
  else
    v_text := v_text || E'\n\n使用场景（usage）：\n' || (p_brief->>'usage');
    foreach v_item in array array['content_requirements', 'visual_direction', 'required_elements', 'forbidden_elements'] loop
      v_text := v_text || E'\n\n' || v_item || E'：\n'
        || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->v_item)), '（无）');
    end loop;
    v_text := v_text || E'\n\n尺寸或媒介（size_or_medium）：\n' || (p_brief->>'size_or_medium')
      || E'\n\nreferences：\n'
      || coalesce((select string_agg('- ' || value, E'\n') from jsonb_array_elements_text(p_brief->'references')), '（无）');
  end if;

  return v_text
    || E'\n\n相关项目（related_project）：\n' || (p_brief->>'related_project')
    || E'\n\n来源正式方案版本（source_plan_version）：\n' || coalesce(p_brief->>'source_plan_version', '未关联');
end;
$$;

commit;
