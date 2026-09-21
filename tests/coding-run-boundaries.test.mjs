import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertSafeAction,
  executeGitAction,
  getRepositoryStatus,
  LocalGitError,
  resolveAllowedRoots,
  resolveLocalRepository,
  resolvePairedRepository,
} from "../runner/local-git.mjs";

const executeFile = promisify(execFile);
const root = new URL("../", import.meta.url);
const source = async (filePath) => readFile(new URL(filePath, root), "utf8");

async function git(cwd, args) {
  return executeFile("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

async function initializeRepository(container) {
  const repositoriesRoot = path.join(container, "repositories");
  const repositoryPath = path.join(repositoriesRoot, "working-copy");
  const remotePath = path.join(container, "studio-remote.git");
  await mkdir(repositoriesRoot, { recursive: true });
  await git(container, ["init", "--bare", remotePath]);
  await mkdir(repositoryPath);
  await git(repositoryPath, ["init", "-b", "main"]);
  await git(repositoryPath, ["config", "user.name", "Sugar Test"]);
  await git(repositoryPath, ["config", "user.email", "sugar@example.invalid"]);
  await writeFile(path.join(repositoryPath, "README.md"), "initial\n");
  await git(repositoryPath, ["add", "README.md"]);
  await git(repositoryPath, ["commit", "-m", "initial"]);
  await git(repositoryPath, ["remote", "add", "origin", remotePath]);
  await git(repositoryPath, ["push", "-u", "origin", "main"]);
  return { repositoriesRoot, repositoryPath, remotePath };
}

async function expectLocalGitError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof LocalGitError);
    assert.equal(error.code, code);
    return true;
  });
}

test("migrates repository and Coding Run storage to local Git", async () => {
  const [baseMigration, localMigration, codexSessionMigration, connectorPromptMigration, conversationRunMigration, continuousPromptMigration] = await Promise.all([
    source("supabase/migrations/20260910160000_project_repositories_and_coding_runs.sql"),
    source("supabase/migrations/20260910210000_local_git_execution.sql"),
    source("supabase/migrations/20260911100000_agent_threads_codex_session.sql"),
    source("supabase/migrations/20260911103000_codex_connector_prompt.sql"),
    source("supabase/migrations/20260917010000_coding_runs_from_conversation.sql"),
    source("supabase/migrations/20260917012000_continuous_coding_prompt.sql"),
  ]);
  assert.match(baseMigration, /private\.is_project_member\(project_id\)/);
  assert.match(baseMigration, /revoke all on table public\.coding_runs from public, anon, authenticated/);
  assert.match(localMigration, /local_repository_path text/);
  assert.match(localMigration, /execution_mode text not null default 'local_repository'/);
  assert.match(localMigration, /branch_before text/);
  assert.match(localMigration, /working_tree_after jsonb/);
  assert.match(localMigration, /commit_sha text/);
  assert.match(localMigration, /push_status text/);
  assert.match(localMigration, /drop function if exists public\.save_project_repository/);
  assert.match(localMigration, /drop function if exists public\.create_coding_run/);
  assert.match(localMigration, /不 clone、不创建独立 workspace、不创建 sugar\/\* 分支/);
  assert.match(codexSessionMigration, /add column codex_thread_id text/);
  assert.match(codexSessionMigration, /codex_thread_id is null or agent_type = 'coding'/);
  assert.match(codexSessionMigration, /where codex_thread_id is not null/);
  assert.match(connectorPromptMigration, /不要在 Codex 外再模拟一层技术判断或结果审阅/);
  assert.match(connectorPromptMigration, /不要对 Codex 的结果再发起第二次模型审阅/);
  assert.match(connectorPromptMigration, /where agent_type = 'coding'/);
  assert.match(conversationRunMigration, /source_kind in \('xiaohua_handoff', 'niuniu_conversation'\)/);
  assert.match(conversationRunMigration, /create function public\.create_conversation_coding_run/);
  assert.match(conversationRunMigration, /thread\.user_id = caller_id/);
  assert.match(conversationRunMigration, /thread\.agent_type = 'coding'/);
  assert.match(conversationRunMigration, /不要求额外准备固定格式的任务文档/);
  assert.match(continuousPromptMigration, /未提交修改是正常的连续工作状态/);
  assert.match(continuousPromptMigration, /直接把 Codex 的最终总结作为牛牛的新回复写入当前对话/);
});

test("recognizes a local repository and a non-GitHub remote", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-local-git-"));
  try {
    const fixture = await initializeRepository(container);
    const allowedRoots = await resolveAllowedRoots([fixture.repositoriesRoot]);
    assert.equal(await resolveLocalRepository(fixture.repositoryPath, allowedRoots), await realpath(fixture.repositoryPath));

    const status = await getRepositoryStatus(fixture.repositoryPath, "origin");
    assert.equal(status.repositoryName, "working-copy");
    assert.equal(status.currentBranch, "main");
    assert.equal(status.remoteUrl, fixture.remotePath);
    assert.deepEqual(status.availableRemotes, ["origin"]);
    assert.equal(status.clean, true);

    await mkdir(path.join(fixture.repositoryPath, "nested"));
    await expectLocalGitError(resolveLocalRepository(path.join(fixture.repositoryPath, "nested"), allowedRoots), "invalid_repository");
    await expectLocalGitError(resolveLocalRepository(container, allowedRoots), "forbidden");

    await writeFile(path.join(fixture.repositoryPath, "含 空格.txt"), "保留用户修改\n");
    const dirty = await getRepositoryStatus(fixture.repositoryPath, "origin");
    assert.equal(dirty.clean, false);
    assert.deepEqual(dirty.changes.map((item) => item.path), ["含 空格.txt"]);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("paired device mode accepts only the exact Git repository root", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-paired-git-"));
  try {
    const fixture = await initializeRepository(container);
    assert.equal(await resolvePairedRepository(fixture.repositoryPath), await realpath(fixture.repositoryPath));
    await mkdir(path.join(fixture.repositoryPath, "nested"));
    await expectLocalGitError(resolvePairedRepository(path.join(fixture.repositoryPath, "nested")), "invalid_repository");
    await expectLocalGitError(resolvePairedRepository(container), "invalid_repository");
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("requires confirmation and rejects high-risk Git actions", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-git-actions-"));
  try {
    const fixture = await initializeRepository(container);
    await expectLocalGitError(executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "pull",
      confirmed: false,
    }), "confirmation_required");
    await expectLocalGitError(executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "push",
      confirmed: false,
    }), "confirmation_required");
    assert.throws(() => assertSafeAction("push --force", true), (error) => {
      assert.ok(error instanceof LocalGitError);
      assert.equal(error.code, "high_risk_operation");
      return true;
    });

    await writeFile(path.join(fixture.repositoryPath, "README.md"), "dirty\n");
    await expectLocalGitError(executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "pull",
      confirmed: true,
    }), "dirty_worktree");
    assert.equal(await readFile(path.join(fixture.repositoryPath, "README.md"), "utf8"), "dirty\n");
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("syncs the remote default branch into the current personal branch", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-git-sync-"));
  try {
    const fixture = await initializeRepository(container);
    await git(fixture.repositoryPath, ["checkout", "-b", "wzybranch"]);

    const peerPath = path.join(container, "peer-sync");
    await git(container, ["clone", fixture.remotePath, peerPath]);
    await git(peerPath, ["checkout", "main"]);
    await git(peerPath, ["config", "user.name", "Peer Test"]);
    await git(peerPath, ["config", "user.email", "peer@example.invalid"]);
    await writeFile(path.join(peerPath, "from-main.txt"), "latest main\n");
    await git(peerPath, ["add", "from-main.txt"]);
    await git(peerPath, ["commit", "-m", "advance main"]);
    await git(peerPath, ["push", "origin", "main"]);

    const result = await executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "sync",
      confirmed: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.currentBranch, "wzybranch");
    assert.equal(await readFile(path.join(fixture.repositoryPath, "from-main.txt"), "utf8"), "latest main\n");
    assert.equal(result.status.clean, true);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("automatic local save commits only files changed by the Codex run", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-scoped-commit-"));
  try {
    const fixture = await initializeRepository(container);
    await writeFile(path.join(fixture.repositoryPath, "README.md"), "user work\n");
    await writeFile(path.join(fixture.repositoryPath, "codex.txt"), "codex work\n");

    const result = await executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "commit",
      confirmed: true,
      commitMessage: "Sugar Agent: scoped save",
      commitPaths: ["codex.txt"],
    });
    assert.deepEqual(result.committedFiles, ["codex.txt"]);
    const committed = await git(fixture.repositoryPath, ["show", "--format=", "--name-only", "HEAD"]);
    assert.equal(committed.stdout.trim(), "codex.txt");
    const status = await getRepositoryStatus(fixture.repositoryPath, "origin");
    assert.deepEqual(status.changes.map((item) => item.path), ["README.md"]);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("stops after a real pull conflict without destructive recovery", async () => {
  const container = await mkdtemp(path.join(tmpdir(), "sugar-pull-conflict-"));
  try {
    const fixture = await initializeRepository(container);
    const peerPath = path.join(container, "peer");
    await git(container, ["clone", fixture.remotePath, peerPath]);
    await git(peerPath, ["config", "user.name", "Peer Test"]);
    await git(peerPath, ["config", "user.email", "peer@example.invalid"]);

    await writeFile(path.join(fixture.repositoryPath, "README.md"), "local version\n");
    await git(fixture.repositoryPath, ["add", "README.md"]);
    await git(fixture.repositoryPath, ["commit", "-m", "local change"]);

    await writeFile(path.join(peerPath, "README.md"), "remote version\n");
    await git(peerPath, ["add", "README.md"]);
    await git(peerPath, ["commit", "-m", "remote change"]);
    await git(peerPath, ["push", "origin", "main"]);

    await assert.rejects(executeGitAction({
      repositoryPath: fixture.repositoryPath,
      remoteName: "origin",
      action: "pull",
      confirmed: true,
    }), (error) => {
      assert.ok(error instanceof LocalGitError);
      assert.equal(error.code, "conflict");
      assert.deepEqual(error.details.status.conflicts, ["README.md"]);
      return true;
    });
    const status = await getRepositoryStatus(fixture.repositoryPath, "origin");
    assert.deepEqual(status.conflicts, ["README.md"]);
    assert.equal(status.currentBranch, "main");
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("keeps Codex in the bound repository without secrets or Git mutation", async () => {
  const [runner, desktop, deviceMigration, envExample, provider, executeRoute, agentPanel, codingRunsPanel] = await Promise.all([
    source("runner/server.mjs"),
    source("runner/desktop.mjs"),
    source("supabase/migrations/20260921030000_runner_project_device_bindings.sql"),
    source(".env.example"),
    source("lib/git/local-git-provider.ts"),
    source("app/api/coding-runs/[id]/execute/route.ts"),
    source("components/AgentPanel.tsx"),
    source("components/CodingRunsPanel.tsx"),
  ]);
  assert.match(runner, /workingDirectory: repositoryPath/);
  assert.match(runner, /resolvePairedRepository/);
  assert.match(runner, /SUGAR_RUNNER_PAIRED_DEVICE_MODE/);
  assert.doesNotMatch(desktop, /允许访问的代码目录/);
  assert.match(desktop, /代码仓库.*页面完成/);
  assert.match(deviceMigration, /runner_device_id uuid/);
  assert.match(deviceMigration, /Runner device access denied/);
  assert.match(runner, /createCodex\(input, repositoryPath, gitGuard, "workspace-write"/);
  assert.match(runner, /JSON\.stringify\(input\.task/);
  assert.match(runner, /input\.run\.sourceKind === "niuniu_conversation"/);
  assert.match(runner, /"read-only",\s+input\.codexThreadId/s);
  assert.match(runner, /client\.resumeThread\(codexThreadId, threadOptions\)/);
  assert.match(runner, /client\.startThread\(threadOptions\)/);
  assert.match(runner, /networkAccessEnabled: false/);
  assert.match(runner, /env: gitGuard\.env/);
  assert.match(runner, /shell_environment_policy/);
  assert.match(runner, /inherit: "none"/);
  assert.match(runner, /Sugar Agent blocks Codex from changing Git state/);
  assert.doesNotMatch(runner, /@openai\/agents(?:"|')/);
  assert.doesNotMatch(runner, /codexTool|new Agent\(|reviewSchema|forceFlush/);
  assert.doesNotMatch(runner, /checkout.*-b|git clone|push --force|reset --hard/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*TOKEN|SUGAR_GITHUB_TOKEN/);
  assert.match(envExample, /SUGAR_LOCAL_REPOSITORY_ROOTS/);
  assert.doesNotMatch(provider, /github\.com|api\.github|SUGAR_GITHUB/);
  assert.match(executeRoute, /repositoryStatus\.conflicts\.length > 0/);
  assert.match(executeRoute, /allowDirtyWorkingTree: true/);
  assert.match(executeRoute, /appendAssistantMessage/);
  assert.doesNotMatch(agentPanel, /任务名称|确认并开始修改|是否保留这些修改/);
  assert.match(agentPanel, /Codex 正在修改…/);
  assert.doesNotMatch(codingRunsPanel, /继续让 Codex 修改|实现摘要|Codex 本轮修改文件|逐文件摘要|Push 到远端/);
  assert.match(codingRunsPanel, /修改了 \$\{run\.changedFiles\.length\} 个文件/);
  assert.match(codingRunsPanel, /查看代码改动/);
  assert.doesNotMatch(codingRunsPanel, /本地保存修改/);
  assert.doesNotMatch(codingRunsPanel, /上传至远端 Git/);
  assert.match(agentPanel, /【Push】同步至远端我的分支/);
  assert.match(agentPanel, /【Sync】拉取主干合并到我的分支/);
  assert.match(executeRoute, /commitChanges\(repository, commitMessage, true, result\.changedFiles\)/);
  assert.match(executeRoute, /buildCodingCommitMessage/);
  assert.doesNotMatch(executeRoute, /commitMessage[^\n]*engineeringTask\.data\.title/);
  assert.match(executeRoute, /status: "completed"/);
  assert.doesNotMatch(codingRunsPanel, /window\.prompt|window\.confirm/);
  assert.match(codingRunsPanel, /border border-\[#d5ddd8\]/);
  assert.match(agentPanel, /cleanCodexCompletionForDisplay/);
  assert.match(agentPanel, /messages\.at\(-1\)\?\.role === "agent"/);
  assert.match(runner, /不要列出验证命令、退出状态、修改文件清单或 Commit\/Push 状态/);
  assert.match(runner, /npm \(run \)\?\(test\|lint\|build\|typecheck\|tsc\)/);
  assert.match(await source("runner/local-git.mjs"), /committedFiles: Array\.isArray\(commitPaths\)/);
});

test("read-only inspection accepts the configured sscd-miniprogram repository", async (context) => {
  const repositoryPath = "/Users/wuzhiyuan/Downloads/sscd-miniprogram";
  try {
    if (!(await stat(repositoryPath)).isDirectory()) return context.skip("目标仓库不在当前测试主机上");
  } catch {
    return context.skip("目标仓库不在当前测试主机上");
  }
  const allowedRoots = await resolveAllowedRoots([repositoryPath]);
  assert.equal(await resolveLocalRepository(repositoryPath, allowedRoots), repositoryPath);
  const status = await getRepositoryStatus(repositoryPath, "origin");
  assert.ok(status.currentBranch.length > 0);
  assert.equal(status.remoteName, "origin");
  assert.ok(status.remoteUrl === null || status.remoteUrl.length > 0);
});
