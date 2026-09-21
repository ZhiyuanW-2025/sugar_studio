# Sugar Agent 知识库 v2

## 知识层级

1. `project_snapshots` 是当前项目已确认的正式状态，优先级最高。
2. 项目知识来自当前项目的 `project_files`，只有项目成员可以访问。
3. 公司知识来自 `company_files`，所有至少加入一个项目的内部工作室成员共享。
4. Conversation 只提供讨论记忆，不自动成为正式知识。

文件资料与正式状态冲突时，Agent 必须以 `get_project_context` 返回的正式状态为准。

## 索引流程

上传文件后，数据库 trigger 自动创建 `knowledge_documents` 和 `knowledge_ingestion_jobs`。上传接口会计算 SHA-256，拒绝同一范围内的重复内容；上传“新版本”时保留旧版本并把新版本设为当前版本。服务端索引任务完成：

1. 再次验证用户身份和项目/工作室权限。
2. 从私有 Supabase Storage 下载源文件。
3. 提取 PDF、DOCX、PPTX、XLSX、TXT 或 Markdown 文字；图片以及没有文本层的扫描 PDF 使用当前用户服务端 Vault 中的 OpenAI 模型做 OCR。
4. 按页或工作表切成有重叠的知识片段。
5. 使用 `text-embedding-3-small` 生成 1536 维 embedding。
6. 只由 service role 写入 `knowledge_chunks`。
7. 持续更新任务进度；成功后把文件状态更新为 `ready`，失败时保存不含密钥和原文的安全错误摘要，并按退避时间最多自动重试三次。

任务既可以由上传后的浏览器请求触发，也可以由受 `SUGAR_KNOWLEDGE_WORKER_SECRET` 保护的 `/api/knowledge/jobs/process` 后台入口批量消费。生产环境应使用定时任务调用后台入口，这样关闭页面也不会中断待处理任务。

## 检索

`search_project_knowledge` 使用混合排序：

- pgvector cosine similarity 负责语义相近内容。
- PostgreSQL 全文索引、精确包含和 trigram similarity 负责关键词、文件术语和专有名词。

一次工具调用最多返回当前项目和公司知识中最相关的少量片段，每条结果携带 scope、文件名、页码、章节和引用正文。`projectId` 由服务端请求上下文固定，模型不能指定其他项目。知识检索抽屉允许成员直接检索、查看命中片段和原文件，并对结果标记“有帮助/没帮助”；查询耗时、命中数量和反馈记录在 `knowledge_search_events`，用于后续调优。

小花、小熊和小雪通过 OpenAI Agents SDK function tool 按需调用。牛牛仍然是 Codex 连接器；当消息涉及项目材料、Brief、规范、公司流程或模板时，Sugar Agent 在调用 Codex 前检索并注入带来源的只读参考内容。

## 权限

- `knowledge_documents`、`knowledge_chunks`、`knowledge_ingestion_jobs` 全部启用 RLS。
- 项目知识只对该项目成员可见。
- 公司知识只对工作室成员可见。
- 浏览器不能直接插入、修改或删除知识片段及 embedding。
- embedding 列不授予普通 authenticated 角色读取权限。
- 混合检索 RPC 只授予 service role。
- 删除源文件会通过 foreign key cascade 删除文档、任务和全部知识片段。
- 文件新版本不会覆盖旧文件；旧版本会标记为 superseded，删除当前版本时数据库会安全恢复上一版本为当前版本。

当前还没有公司管理员角色，因此公司知识的上传和删除暂时对所有工作室成员开放。后续增加 Workspace Admin 时，只需收紧公司文件 RPC 和 Storage policy，不需要重建知识索引结构。
