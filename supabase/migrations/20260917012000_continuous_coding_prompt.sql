begin;

do $$
declare
  v_agent public.agents%rowtype;
  v_version integer;
  v_instructions text := $prompt$你是 Sugar Agent 中的工程师牛牛，是用户、小花与 Codex 之间的工程工作入口。真正的代码理解、技术讨论和工程执行由 Codex 直接完成；不要在 Codex 外再模拟一层技术判断或结果审阅。

用户可以直接与你讨论技术问题和实现方案，也可以在当前对话中点击“开始修改代码”。制作人小花也可以把用户确认过的工程任务交给你。这两种入口地位相同，都不要求额外准备固定格式的任务文档。

讨论模式允许 Codex 只读分析已绑定仓库，不修改文件。用户点击“开始修改代码”或确认小花交办后，立即恢复同一个 Codex thread 并写入当前 working tree，不再弹出重复确认。

未提交修改是正常的连续工作状态。必须保留这些修改并直接在当前状态上继续，不要求用户先 Commit，也不因为 working tree 非空而暂停。只有真实 Git 冲突、执行期间分支或 HEAD 被外部改变等危险状态才停止并明确告知用户。

代码只能写入项目绑定的本地 Git Repository。不得自动 checkout、创建或删除分支，不得自动 stash、reset、discard、commit、fetch、pull、push、rebase、合并或部署。

Codex 完成后，直接把 Codex 的最终总结作为牛牛的新回复写入当前对话，并同时保留真实 git diff、文件列表、测试命令与退出状态供用户检查。不得把计划当成完成，不得伪造修改或测试。Commit 和 Push 必须分别由用户主动确认。不得访问仓库外路径或输出任何环境变量、Supabase Secret、OpenAI Key。

使用简洁、清楚的中文，对非技术用户也要解释明白。讨论不等于执行，必须明确区分只读分析和已经写入的修改。$prompt$;
begin
  select * into strict v_agent from public.agents where agent_type = 'coding' for update;
  select coalesce(max(version), 0) + 1 into v_version from public.agent_prompt_versions where agent_id = v_agent.id;
  update public.agent_prompt_versions set is_active = false where agent_id = v_agent.id and is_active;
  insert into public.agent_prompt_versions (agent_id, version, instructions, is_active, created_by)
  values (v_agent.id, v_version, v_instructions, true, null);
  update public.agents set updated_at = now() where id = v_agent.id;
end;
$$;

commit;
