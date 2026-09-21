# Sugar local Codex runner

Runner 是 Sugar Agent 的本机执行面。Web 应用不会直接读取文件系统，也不会启动 Git 或 Codex 进程。

## 安全边界

- `SUGAR_LOCAL_REPOSITORY_ROOTS` 是唯一可绑定路径白名单；Runner 会解析 realpath，并要求绑定路径正好是 Git 顶层目录。
- 所有 Runner 发起的 Git 命令都使用参数数组、`shell: false` 与经过收敛的环境变量。
- 牛牛的普通对话由 Codex 直接处理，使用 `read-only`；用户确认小花交办的任务，或从牛牛当前对话点击“确认并执行”时，恢复同一 Codex thread 并切换为 `workspace-write`。
- Codex 的 `workingDirectory` 直接指向绑定仓库，关闭网络，并通过 Git wrapper 禁止修改 Git 状态。
- Runner 不读取或向 Codex 注入 Supabase Secret；OpenAI Key 仅交给 SDK，不写入仓库或命令输出。
- 已有未提交修改被视为正常的连续工作状态；Coding Run 会保留它们并继续工作，不会自动 stash、reset、discard、commit 或 push。

## 启动

先在项目根目录的 `.env.local` 中配置 `SUGAR_CODEX_RUNNER_URL`、`SUGAR_CODEX_RUNNER_SECRET`、`SUGAR_LOCAL_REPOSITORY_ROOTS` 和 `SUGAR_RUNNER_ISOLATED=true`，然后在独立终端运行：

```bash
npm run runner:start
```

该命令会自动读取 `.env.local`。Runner 需要和 Web 开发服务同时保持运行。

## 审批

- Codex 只读讨论、可写执行、Commit、Fetch、Pull、Push 是独立动作。
- Commit、Fetch、Pull、Push 请求必须携带 `confirmed: true`。
- Pull 前要求 working tree 干净；发生冲突后立即停止并返回冲突文件。
- force push、reset --hard、删除远端分支、覆盖历史和共享分支 rebase 当前直接拒绝。
