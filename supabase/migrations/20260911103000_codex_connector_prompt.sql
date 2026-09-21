do $$
declare
  v_agent public.agents%rowtype;
  v_version integer;
  v_prompt_id uuid;
  v_instructions text := $prompt$你是 Sugar Agent 中的工程师牛牛，是用户、策划师小花与 Codex 之间的工程工作入口。真正的代码理解、技术讨论和工程执行由 Codex 直接完成；不要在 Codex 外再模拟一层技术判断或结果审阅。

你的职责是：让用户可以直接和 Codex 讨论问题、方案、依赖、影响范围与技术取舍；把已确认的 Technical Brief 清楚、完整地交给 Codex；在用户明确点击执行后恢复同一 Codex thread；向用户展示 Codex 的结论，以及系统客观读取到的 git diff、文件列表和测试退出状态。

讨论模式允许 Codex 只读访问当前项目已绑定的仓库，不允许修改任何文件，也不得声称已经执行或修改。只有用户点击明确的“交给 Codex 执行”或继续执行动作后，Codex 才能进入 workspace-write。来自小花且已由用户确认的 Technical Brief 可以直接交给 Codex，不需要牛牛再做一次模型理解或审批。

goal、requirements、constraints、unchanged_scope、acceptance_criteria 共同构成执行输入，其中 unchanged_scope 是硬边界。不得擅自扩大任务范围。代码只能写入当前项目绑定的本地 Git Repository，并使用用户当前 checkout 的分支和 working tree。不得自动 checkout、创建或删除分支，不得自动 stash、reset、discard、commit、fetch、pull、push、rebase、合并或部署。已有未提交修改时，系统必须先展示文件并由用户选择继续或取消。

不要对 Codex 的结果再发起第二次模型审阅。执行后只呈现 Codex 的原始总结和系统机械读取的 changed files、git diff、命令与退出状态。测试失败、未运行或执行受阻时必须如实展示。

不得访问仓库外路径，不得读取或输出环境变量、Supabase Secret、OpenAI Key 或 Vault 内容。使用简洁、清楚的中文；讨论不等于执行，必须明确区分只读分析与已经写入的修改。$prompt$;
begin
  select * into strict v_agent
  from public.agents
  where agent_type = 'coding'
  for update;

  select coalesce(max(version), 0) + 1 into v_version
  from public.agent_prompt_versions
  where agent_id = v_agent.id;

  update public.agent_prompt_versions
  set is_active = false
  where agent_id = v_agent.id and is_active;

  insert into public.agent_prompt_versions (
    agent_id,
    version,
    instructions,
    is_active,
    created_by
  ) values (
    v_agent.id,
    v_version,
    v_instructions,
    true,
    null
  ) returning id into v_prompt_id;

  insert into public.agent_config_activities (
    agent_id,
    user_id,
    event_type,
    actor_type,
    actor,
    summary,
    related_entity_id
  ) values (
    v_agent.id,
    null,
    'agent_prompt_changed',
    'agent',
    '系统迁移',
    format('将全局%s调整为 Codex 连接器，更新提示词至 v%s', v_agent.name, v_version),
    v_prompt_id
  );
end;
$$;
