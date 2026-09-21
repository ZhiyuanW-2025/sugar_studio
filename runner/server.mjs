import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import {
  executeGitAction,
  fingerprintPaths,
  getRepositoryDiff,
  getRepositoryStatus,
  gitEnvironment,
  LocalGitError,
  resolveAllowedRoots,
  resolveLocalRepository,
  resolvePairedRepository,
  runCommand,
} from "./local-git.mjs";

const host = process.env.SUGAR_CODEX_RUNNER_HOST || "127.0.0.1";
const port = Number(process.env.SUGAR_CODEX_RUNNER_PORT || 4391);
const sharedSecret = process.env.SUGAR_CODEX_RUNNER_SECRET;
const isolated = process.env.SUGAR_RUNNER_ISOLATED === "true";
const pairedDeviceMode = process.env.SUGAR_RUNNER_PAIRED_DEVICE_MODE === "true";
const configuredRepositoryRoots = (process.env.SUGAR_LOCAL_REPOSITORY_ROOTS || "")
  .split(path.delimiter)
  .map((item) => item.trim())
  .filter(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function equalSecret(value) {
  if (!sharedSecret || !value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(sharedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new LocalGitError("invalid_response", "Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function validateRunnerBoundary() {
  if (!isolated) throw new LocalGitError("forbidden", "Runner host has not declared a trusted execution boundary.");
}

function validateRepositoryInput(input) {
  if (!input?.repository || input.repository.provider !== "local_git") {
    throw new LocalGitError("invalid_repository", "当前 Runner 只支持 local_git 仓库。");
  }
  if (typeof input.repository.localRepositoryPath !== "string") {
    throw new LocalGitError("invalid_repository", "本地仓库路径缺失。");
  }
  if (!uuidPattern.test(input.repository.projectId)) {
    throw new LocalGitError("invalid_repository", "项目仓库绑定无效。");
  }
  return input.repository;
}

async function resolveInputRepository(input) {
  validateRunnerBoundary();
  const repository = validateRepositoryInput(input);
  const repositoryPath = pairedDeviceMode
    ? await resolvePairedRepository(repository.localRepositoryPath)
    : await resolveLocalRepository(
        repository.localRepositoryPath,
        await resolveAllowedRoots(configuredRepositoryRoots),
      );
  return { repository, repositoryPath };
}

function validateExecution(input) {
  if (!uuidPattern.test(input?.run?.id)) {
    throw new LocalGitError("invalid_response", "Invalid Coding Run.");
  }
  const hasValidSource = input.run.sourceKind === "xiaohua_handoff"
    ? uuidPattern.test(input.run.handoffTaskId)
    : input.run.sourceKind === "niuniu_conversation"
      && uuidPattern.test(input.run.sourceThreadId)
      && uuidPattern.test(input.run.sourceMessageId);
  if (!hasValidSource) throw new LocalGitError("invalid_response", "Invalid Coding Run source.");
  if (input.run.projectId !== input.repository.projectId) {
    throw new LocalGitError("forbidden", "Repository/project mismatch.");
  }
  if (input.run.executionMode !== "local_repository") {
    throw new LocalGitError("invalid_response", "Coding Run execution mode is not local_repository.");
  }
  if (typeof input.apiKey !== "string" || !input.apiKey) {
    throw new LocalGitError("forbidden", "Runner OpenAI credential is missing.");
  }
  if (typeof input.instructions !== "string" || typeof input.model !== "string" || !input.task) {
    throw new LocalGitError("invalid_response", "Runner task is incomplete.");
  }
}

function clean(value, secrets) {
  let output = String(value || "");
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output.slice(0, 20_000);
}

async function createGitGuard() {
  const realGit = (await runCommand("which", ["git"])).stdout.trim();
  if (!realGit) throw new LocalGitError("forbidden", "Runner 找不到 Git CLI。");
  const directory = await mkdtemp(path.join(tmpdir(), "sugar-git-guard-"));
  const executable = path.join(directory, "git");
  const script = `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const command = args[0] || "";
const readOnly = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "grep", "blame"]);
const safeBranch = command === "branch" && (args.length === 1 || args.slice(1).every((arg) => ["--show-current", "--list", "-a", "-r", "-v", "-vv"].includes(arg)));
if (!readOnly.has(command) && !safeBranch) {
  process.stderr.write("Sugar Agent blocks Codex from changing Git state. Commit, pull and push require explicit user actions.\\n");
  process.exit(97);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit", env: process.env, shell: false });
process.exit(result.status === null ? 1 : result.status);
`;
  await writeFile(executable, script, { mode: 0o700 });
  await chmod(executable, 0o700);
  return {
    directory,
    env: gitEnvironment({ PATH: `${directory}${path.delimiter}${process.env.PATH || "/usr/bin:/bin"}` }),
  };
}

function createCodex(input, repositoryPath, gitGuard, sandboxMode, codexThreadId, skipGitRepoCheck = false) {
  const client = new Codex({
    apiKey: input.apiKey,
    env: gitGuard.env,
    config: {
      shell_environment_policy: {
        inherit: "none",
        set: gitGuard.env,
      },
    },
  });
  const threadOptions = {
    model: input.model,
    threadSource: "sugar-agent",
    workingDirectory: repositoryPath,
    sandboxMode,
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    skipGitRepoCheck,
  };
  return codexThreadId
    ? client.resumeThread(codexThreadId, threadOptions)
    : client.startThread(threadOptions);
}

async function headFingerprint(repositoryPath, relativePath) {
  const result = await runCommand("git", ["rev-parse", `HEAD:${relativePath}`], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  return result.code === 0 ? result.stdout.trim() : "__absent__";
}

async function detectChangedFiles(repositoryPath, beforeStatus, beforeFingerprints, afterStatus) {
  const paths = [...new Set([
    ...beforeStatus.changes.map((item) => item.path),
    ...afterStatus.changes.map((item) => item.path),
  ])].sort();
  const afterFingerprints = await fingerprintPaths(repositoryPath, paths);
  const beforePaths = new Set(beforeStatus.changes.map((item) => item.path));
  const changed = [];
  for (const relativePath of paths) {
    const before = beforePaths.has(relativePath)
      ? beforeFingerprints.get(relativePath)
      : await headFingerprint(repositoryPath, relativePath);
    if (before !== afterFingerprints.get(relativePath)) changed.push(relativePath);
  }
  return changed;
}

async function execute(input) {
  validateExecution(input);
  const { repository, repositoryPath } = await resolveInputRepository(input);
  const remoteName = repository.remoteName || "origin";
  const beforeStatus = await getRepositoryStatus(repositoryPath, remoteName);
  if (input.run.workingBranch !== beforeStatus.currentBranch) {
    throw new LocalGitError(
      "conflict",
      `Coding Run 记录的分支与当前 checkout 分支不一致（${input.run.workingBranch} → ${beforeStatus.currentBranch}）。请刷新后重新开始。`,
      { status: beforeStatus },
    );
  }
  if (!beforeStatus.clean && input.allowDirtyWorkingTree !== true) {
    throw new LocalGitError(
      "dirty_worktree",
      "当前仓库已经存在未提交修改。请确认是否继续在当前状态上工作。",
      { status: beforeStatus },
    );
  }
  const beforeFingerprints = await fingerprintPaths(
    repositoryPath,
    beforeStatus.changes.map((item) => item.path),
  );
  const secrets = [input.apiKey, sharedSecret];
  const gitGuard = await createGitGuard();
  let result;
  let codexThreadId = input.run.codexThreadId || null;
  try {
    const thread = createCodex(input, repositoryPath, gitGuard, "workspace-write", codexThreadId);
    result = await thread.run([
      input.instructions,
      "你现在直接执行以下用户已确认的工程任务。任务可能来自制作人小花的交办，也可能来自用户与工程师牛牛的当前对话；两者具有相同效力，不要求额外准备固定格式的任务文档。用户已明确点击执行，可以修改当前 working tree。严格遵守任务边界，不要再次要求确认。不要改变 Git 状态，不要访问仓库外路径，不要创建 PR、合并或部署。完成后运行仓库已有且与改动相关的测试、lint 或 build。最终回复只需用中文自然、简洁地说明完成了什么以及仍存在的阻塞；第一句必须依据最终代码改动概括实际完成结果，不要只是复述用户原始要求。不要列出验证命令、退出状态、修改文件清单或 Commit/Push 状态，这些信息会由 Sugar Agent 界面单独展示。",
      `执行前分支：${beforeStatus.currentBranch}`,
      `执行前 HEAD：${beforeStatus.headCommit}`,
      `执行前未提交文件：${beforeStatus.changes.map((item) => item.path).join("、") || "无"}`,
      `已确认工程任务：\n${JSON.stringify(input.task, null, 2)}`,
      input.continuation ? `用户要求继续修改：\n${input.continuation}` : "",
    ].filter(Boolean).join("\n\n"));
    codexThreadId = thread.id;
  } finally {
    await rm(gitGuard.directory, { recursive: true, force: true });
  }
  if (!codexThreadId || !result?.finalResponse?.trim()) {
    throw new LocalGitError("invalid_response", "Codex did not return a complete result.");
  }

  const afterStatus = await getRepositoryStatus(repositoryPath, remoteName);
  if (afterStatus.currentBranch !== beforeStatus.currentBranch) {
    throw new LocalGitError("high_risk_operation", "Codex 改变了当前分支，Runner 已停止；不会自动 checkout 或 reset。", { beforeStatus, afterStatus });
  }
  if (afterStatus.headCommit !== beforeStatus.headCommit) {
    throw new LocalGitError("high_risk_operation", "Codex 改变了 HEAD，Runner 已停止；不会自动回滚该 commit。", { beforeStatus, afterStatus });
  }
  const changedFiles = await detectChangedFiles(repositoryPath, beforeStatus, beforeFingerprints, afterStatus);
  if (!changedFiles.length) throw new LocalGitError("conflict", "Codex completed without any new code changes.");
  const diff = await getRepositoryDiff(repositoryPath);
  const testCommands = result.items
    .filter((item) => item.type === "command_execution")
    .filter((item) => /(^|\s)(test|pytest|vitest|jest|lint|build|typecheck|tsc)(\s|$)|npm (run )?(test|lint|build|typecheck|tsc)|pnpm (run )?(test|lint|build|typecheck|tsc)|yarn (run )?(test|lint|build|typecheck|tsc)/i.test(item.command))
    .map((item) => ({
      command: clean(item.command, secrets),
      status: item.exit_code === 0 ? "passed" : "failed",
      exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
      output: clean(item.aggregated_output, secrets).slice(-4000),
    }));
  const testStatus = testCommands.length === 0 ? "not_run" : testCommands.some((item) => item.status === "failed") ? "failed" : "passed";
  const implementationSummary = clean(result.finalResponse, secrets);
  return {
    codexThreadId,
    changeSummary: implementationSummary,
    implementationSummary,
    changedFiles,
    fileSummaries: [],
    diffSummary: clean(diff.summary, secrets),
    gitDiff: clean(diff.diff, secrets),
    testResult: { status: testStatus, commands: testCommands },
    unresolvedItems: [],
    riskNotes: [],
    headCommitSha: afterStatus.headCommit,
    branchBefore: beforeStatus.currentBranch,
    headBefore: beforeStatus.headCommit,
    workingTreeBefore: beforeStatus.changes,
    branchAfter: afterStatus.currentBranch,
    headAfter: afterStatus.headCommit,
    workingTreeAfter: afterStatus.changes,
    commitSha: null,
    pushStatus: "not_requested",
  };
}

async function discuss(input) {
  if (typeof input.apiKey !== "string" || !input.apiKey || typeof input.model !== "string") {
    throw new LocalGitError("forbidden", "Runner OpenAI credential is missing.");
  }
  if (typeof input.message !== "string" || !input.message.trim() || typeof input.instructions !== "string") {
    throw new LocalGitError("invalid_response", "Codex discussion input is incomplete.");
  }
  validateRunnerBoundary();
  const temporaryDirectory = input.repository
    ? null
    : await mkdtemp(path.join(tmpdir(), "sugar-codex-discussion-"));
  const repositoryPath = input.repository
    ? (await resolveInputRepository(input)).repositoryPath
    : temporaryDirectory;
  if (!repositoryPath) throw new LocalGitError("invalid_repository", "Codex discussion directory is unavailable.");
  const gitGuard = await createGitGuard();
  try {
    const thread = createCodex(
      input,
      repositoryPath,
      gitGuard,
      "read-only",
      input.codexThreadId || null,
      !input.repository,
    );
    const history = !input.codexThreadId && Array.isArray(input.history)
      ? input.history.slice(-20).map((item) => `${item.role}: ${String(item.content || "").slice(0, 8000)}`).join("\n")
      : "";
    const result = await thread.run([
      input.instructions,
      input.repository
        ? "你是 Sugar Agent 中工程师牛牛背后的 Codex 能力。当前是讨论模式：可以读取和分析已绑定仓库，但绝对不能修改文件。直接回答用户的技术问题、讨论方案、指出取舍；不要声称已经修改或执行代码。用户可以在当前对话中点击“确认并执行”，系统随后会以可写模式恢复此 thread；不要求额外准备某种固定格式的文档。"
        : "你是 Sugar Agent 中工程师牛牛背后的 Codex 能力。当前项目尚未绑定代码仓库。你仍可讨论通用技术问题、澄清需求和提出实现方案，但必须明确说明你此刻没有读取项目代码，绝对不能声称已经检查、修改或执行代码。",
      history ? `Sugar Agent 已保存的既往对话（仅首次建立 Codex thread 时补入）：\n${history}` : "",
      `用户本轮消息：\n${input.message.trim()}`,
    ].filter(Boolean).join("\n\n"));
    if (!thread.id || !result.finalResponse?.trim()) {
      throw new LocalGitError("invalid_response", "Codex did not return a discussion response.");
    }
    return {
      reply: clean(result.finalResponse, [input.apiKey, sharedSecret]),
      codexThreadId: thread.id,
    };
  } finally {
    await rm(gitGuard.directory, { recursive: true, force: true });
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function inspectRepository(input) {
  const { repository, repositoryPath } = await resolveInputRepository(input);
  return getRepositoryStatus(repositoryPath, repository.remoteName || "origin");
}

async function repositoryDiff(input) {
  const { repositoryPath } = await resolveInputRepository(input);
  return getRepositoryDiff(repositoryPath);
}

async function repositoryAction(input) {
  const { repository, repositoryPath } = await resolveInputRepository(input);
  return executeGitAction({
    repositoryPath,
    remoteName: repository.remoteName || "origin",
    action: input.action,
    confirmed: input.confirmed,
    commitMessage: input.commitMessage,
    commitPaths: input.commitPaths,
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST") return json(response, 404, { error: "Not found." });
  if (!equalSecret(request.headers.authorization)) return json(response, 401, { error: "Runner authentication failed." });
  try {
    const input = await readBody(request);
    if (request.url === "/v1/repositories/inspect") return json(response, 200, { status: await inspectRepository(input) });
    if (request.url === "/v1/repositories/diff") return json(response, 200, await repositoryDiff(input));
    if (request.url === "/v1/repositories/action") return json(response, 200, { result: await repositoryAction(input) });
    if (request.url === "/v1/codex/discuss") return json(response, 200, { result: await discuss(input) });
    if (request.url === "/v1/coding-runs/execute") return json(response, 200, { result: await execute(input) });
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    const isLocalGitError = error instanceof LocalGitError;
    const rawMessage = error instanceof Error ? error.message : "Runner operation failed.";
    const safeMessage = /credential|token|api.?key/i.test(rawMessage)
      ? "Runner credentials or trust boundary are not configured."
      : rawMessage;
    return json(response, isLocalGitError && error.code === "confirmation_required" ? 409 : 422, {
      error: safeMessage.slice(0, 500),
      code: isLocalGitError ? error.code : "invalid_response",
      details: isLocalGitError ? error.details : undefined,
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Sugar local Codex runner listening on http://${host}:${port}\n`);
});
