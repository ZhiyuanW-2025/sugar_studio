# Sugar Studio

Sugar Agent 是工作室内部的多 Agent 协作工作台。当前版本使用 Next.js、React、TypeScript、Tailwind CSS、Supabase 与 OpenAI Agents SDK。

## Supabase connection

Copy `.env.example` to `.env.local` and replace the placeholders with the
Project URL and publishable key from the Supabase project Connect dialog.
Model settings also require the server-only `SUPABASE_SECRET_KEY` from
Dashboard → Settings → API Keys. Never prefix it with `NEXT_PUBLIC_`.
`.env.local` is ignored by Git.

```bash
cp .env.example .env.local
npm run dev
curl http://localhost:3000/api/supabase/health
```

成功时服务端连接测试返回 `{"ok":true,"service":"supabase","status":200}`。健康检查为只读。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## 当前能力

- Supabase email/password Auth、项目成员关系与 RLS
- 用户模型配置、Vault API Key 与 Agent 模型偏好
- 小花主工作区与按需打开的牛牛、小熊、小雪专业工作通道
- 策划师小花、艺术家小熊、客户伙伴小雪的真实 Agents SDK 对话，以及牛牛的直接 Codex 对话
- `agent_threads` 作为用户 × 项目 × Agent 的稳定工作通道；每个通道支持多个可命名、切换、搜索和归档的长期会话
- 模型上下文使用长期摘要 + 最近 20 条消息，完整消息仍保存在 Sugar Agent 数据库中，不锁定 OpenAI 托管会话
- `get_project_context` 项目工具
- 正式策划版本、Prompt 版本与回滚
- 私有项目文件上传、签名下载与删除
- 项目级与公司级知识库、批量上传、文件去重与版本链、PDF/Office/文本解析、图片/扫描 PDF OCR、后台重试队列、混合向量检索、来源预览与质量反馈
- `search_project_knowledge` Agent 工具；项目正式状态仍以 `get_project_context` 为准
- 经用户确认的双向 Agent-to-Agent 任务交接、资料附件、状态跟踪与协作任务抽屉
- 本地 Git 仓库绑定、Technical Brief → Coding Run、显式 Commit/Pull/Push 审批
- 项目 Activity 时间线
- 小雪的 B 端材料模板、不可变版本、人工批准、DOCX/PDF/PPTX 导出，以及受控邮件/企业微信发送审计
- 真实项目创建/切换/归档、成员添加与邮件邀请；个人资料、头像、密码、全设备退出和安全记录

业务数据库变更全部位于 `supabase/migrations/`。不要在 Dashboard 中手工修改 schema。

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: production build、服务端渲染边界和客户端泄密检查
- `npm run test:project-files`: 项目文件端到端测试（需要运行中的 production server）
- `npm run test:knowledge-base`: 知识解析、项目/公司权限、真实检索与 Agent Tool 端到端测试
- `npm run test:knowledge-v2`: 文件版本、重复检测、内容预览、检索反馈和 OCR 端到端测试
- `npm run test:client-deliverables`: 小雪材料版本、批准、三种导出和发送门禁测试
- `npm run test:long-term-conversations`: 多会话、搜索、归档、隔离和摘要存储测试
- `npm run test:collaboration`: 双向交接、附件、状态与权限测试
- `npm run test:account`: 资料、头像、密码、安全记录和权限审计测试
- `npm run test:specialist-agents`: 牛牛/小熊真实模型与 Session 测试
- `npm run test:handoff-api`: 任务交接端到端测试
- `npm run runner:desktop`: 启动带配对界面的 Sugar Runner 本地助手
- `npm run runner:build:mac`: 构建自带 Node、Codex SDK 和 Codex 二进制的 macOS 安装包

## 本地 Git 与 Sugar Runner

Web 应用只负责鉴权、数据和审批控制面。真实文件与 Git 操作由每位用户 Mac 上的 Sugar Runner 执行：牛牛通过 `@openai/codex-sdk` 连接 Codex。普通对话使用只读模式；明确执行时恢复同一 Codex thread，并把 `workingDirectory` 设为项目绑定的现有本地 Git Repository。

线上使用采用“设备模式”：用户在“账户设置 → Sugar Runner”生成一次性配对码，在本地助手中填入网站地址、配对码和允许访问的代码目录。Runner 只通过 HTTPS 主动领取属于该用户的任务，无需公网暴露本机端口。设备 token 只保存在该 Mac；服务端只存 SHA-256 hash。OpenAI Key 不写入 Runner 任务表，由服务端在已认证设备领取 Codex 任务时临时提供。

1. 执行 `npm run runner:build:mac` 生成当前 Mac 架构的 `.app` 与 `.dmg`。
2. 将经过 Apple Developer ID 签名和 notarization 的 DMG 上传到下载服务，并配置 `NEXT_PUBLIC_SUGAR_RUNNER_DOWNLOAD_URL`。
3. 线上设置 `SUGAR_RUNNER_TRANSPORT=device`；不要设置指向云服务器自身 `127.0.0.1` 的 Runner URL。
4. 用户安装 Sugar Runner、完成一次性配对、选择允许访问的代码目录，再在项目“代码仓库”中绑定具体仓库路径。

本地开发仍可使用直接模式：配置 `SUGAR_RUNNER_TRANSPORT=direct`、`SUGAR_CODEX_RUNNER_URL`、`SUGAR_CODEX_RUNNER_SECRET`、`SUGAR_LOCAL_REPOSITORY_ROOTS` 和 `SUGAR_RUNNER_ISOLATED=true` 后运行 `npm run runner:start`。

Runner 不 clone、不 checkout、不创建 `sugar/*` 分支。Codex 只能修改当前 working tree，且 Git 命令护栏阻止其 add、commit、fetch、pull、push、reset、stash 或 rebase。Commit、Fetch、Pull、Push 分别由用户点击确认；force push、reset --hard、远端删分支及共享分支 rebase 直接拒绝。未来 GitHub、GitLab、Gitea 和自建 Git Server 可继续实现同一 `GitProvider` 接口。

加载 `.env.local` 后，可用 `npx supabase db push --dry-run` 检查远端迁移状态。

知识库详细边界、状态和检索流程见 [`docs/knowledge-base.md`](docs/knowledge-base.md)。知识索引固定使用 `text-embedding-3-small`，API Key 仅由服务端从当前操作用户的 Vault 模型配置解析，不写入知识表、日志或浏览器响应。

飞书企业知识库连接、权限与回调配置见 [`docs/feishu-knowledge.md`](docs/feishu-knowledge.md)。飞书 App Secret、访问令牌和回调校验 Token 只在服务端使用；用户上传、同步以及 Agent 提议创建或修改文档都经过 Sugar Agent 的项目/工作区成员校验，其中 Agent 写操作还需要用户在界面中确认后才会真正执行。

## 生产环境可选配置

- `SUGAR_KNOWLEDGE_WORKER_SECRET`：保护后台知识任务消费接口。部署平台的 Cron 应定时 POST `/api/knowledge/jobs/process`，并发送 `Authorization: Bearer <secret>`。
- `RESEND_API_KEY` 与 `SUGAR_DELIVERY_FROM_EMAIL`：开启小雪批准后的邮件发送。未配置时系统明确拒绝发送并保留失败审计，不会假装已发送。
- `SUGAR_WECOM_WEBHOOK_URL`：开启企业微信群机器人受控发送，只接受 `qyapi.weixin.qq.com` HTTPS 地址。
- Supabase Dashboard → Authentication：邀请和忘记密码邮件依赖站点 URL、Redirect URLs 与 SMTP。至少允许 `/auth/callback` 和 `/auth/confirm`。

所有上述值都是服务端 Secret，不得增加 `NEXT_PUBLIC_` 前缀。对外发送永远要求先批准材料，再由用户二次确认。
