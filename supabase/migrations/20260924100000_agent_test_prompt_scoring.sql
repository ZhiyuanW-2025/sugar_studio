begin;

alter table public.agent_test_versions
  add column prompt_override text,
  add constraint agent_test_versions_prompt_override_length
    check (prompt_override is null or char_length(prompt_override) between 1 and 30000);

alter table public.agent_test_run_results
  add column score smallint,
  add column scored_at timestamptz,
  add constraint agent_test_run_results_score_range
    check (score is null or score between 1 and 10);

commit;
