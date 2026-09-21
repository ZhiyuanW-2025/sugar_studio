# 飞书企业知识库连接

Sugar Agent 把飞书知识空间作为正式内容的权威来源。飞书新版文档会按用户配置的范围，以文本镜像进入 `company_files` 或 `project_files`，再进入 `knowledge_documents` 和 `knowledge_chunks` 检索链路；Agent 不会在每次回答时临时下载整篇飞书文档。

## 飞书后台配置

1. 在飞书开放平台创建“企业自建应用”。
2. 在“权限管理”开通应用身份权限：
   - `wiki:wiki`（查看、编辑和管理知识库）
   - `docx:document`（创建及编辑新版文档）
   - `drive:drive`（上传与管理云空间文件）
   - “查看、评论和导出电子表格”（需要索引电子表格时）
   - “查看、评论和导出多维表格”（需要索引多维表格时）
3. 创建并发布应用版本，等待企业管理员审批生效。
4. 把应用添加为要连接的知识空间成员或管理员，确保它拥有目标根节点的阅读、容器编辑和文档编辑权限。
5. 从“凭证与基础信息”复制 App ID 与 App Secret。
6. 在 Sugar Agent 的“公司知识”或“项目材料”区域中粘贴知识空间/目录 URL。服务端会解析 `space_id` 和 `node_token` 并验证权限。
7. App ID 与 App Secret 填入项目根目录 `.env.local`，不要提交到 Git；知识范围由前端保存到 Supabase。

## 环境变量

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_SPACE_ID`：仅兼容旧配置；新连接无需填写。
- `FEISHU_ROOT_NODE_TOKEN`：仅兼容旧配置。
- `FEISHU_TENANT_URL`：可选；用于生成可点击的飞书页面链接。
- `FEISHU_VERIFICATION_TOKEN`：启用事件回调时填写。

## 同步和写入

- 用户可以分别把飞书目录连接为公司知识或当前项目知识；“测试连接”只验证地址和空间权限。
- “立即同步”遍历所选范围，将变更过的 `docx` 页面镜像并重新索引。
- 飞书新版文档按 block、电子表格按行、多维表格按 record 镜像为可检索文本；思维笔记和未由 Sugar Agent 上传的普通文件节点暂只记录来源。
- 策划师小花、艺术家小熊和客户伙伴小雪在用户明确要求时，可以创建飞书变更草稿；用户在 Agent 面板确认后才真正写入。
- 小花输入框选择“飞书企业知识”后，可以把不超过 20 MB 的文件上传到应用云空间并迁入目标知识空间。
- 修改已有段落按飞书 block ID 和 revision 执行三方比较：其他 block 变化可自动合并，同一 block 同时变化则交给用户选择。

## 事件同步

部署后可将飞书事件回调 URL 设置为：

`https://你的域名/api/integrations/feishu/events`

回调使用 Verification Token 校验。第一版不接收加密事件体，因此事件配置中不要启用 Encrypt Key。事件会进入 `feishu_sync_events`，现有知识 worker 定时调用 `/api/knowledge/jobs/process` 时消费并重新同步文档。该 worker 也会执行到期的每周完整对账；部署平台应至少每日调用一次，系统只会在具体范围到期时进行全量读取。

## 权威源与冲突

飞书是正式内容的权威源，Supabase 只保存可重建的内容镜像、检索块和 revision 快照。Agent 写入前保存基础 revision，用户确认时重新读取飞书：不同 block 的变化会自动合并；同一 block 同时变化会生成 `feishu_merge_conflicts`，由用户选择飞书版、Agent 版或填写人工合并结果。写入成功后始终重新从飞书读取并更新 Supabase。

电子表格与多维表格已经支持读取和索引，但不复用文档段落写入逻辑；结构化表格的 Agent 写入需要后续单独定义单元格/记录级确认协议。
