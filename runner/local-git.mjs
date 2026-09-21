import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const remotePattern = /^[A-Za-z0-9._-]+$/;
const branchUnsafePattern = /(?:^|\/)\.\.(?:\/|$)|[~^:?*\[\\\s]/;
const conflictStatuses = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function redactCredentials(value) {
  return String(value || "").replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");
}

export class LocalGitError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function gitEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

export async function runCommand(commandName, args, options = {}) {
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    throw new LocalGitError("invalid_repository", "命令参数无效。");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: options.cwd,
      env: options.env || gitEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new LocalGitError(
        options.errorCode || "invalid_response",
        options.errorMessage || `${commandName} 执行失败（exit ${code ?? 1}）。`,
        { stderr: redactCredentials(stderr).slice(-2000) },
      ));
    });
  });
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function withinRoot(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export async function resolveAllowedRoots(configuredRoots) {
  const roots = Array.isArray(configuredRoots) ? configuredRoots : [];
  if (!roots.length) {
    throw new LocalGitError("forbidden", "Runner 尚未配置 SUGAR_LOCAL_REPOSITORY_ROOTS。");
  }
  const resolved = [];
  for (const configured of roots) {
    if (!path.isAbsolute(configured) || configured === path.parse(configured).root) {
      throw new LocalGitError("forbidden", "本地仓库白名单必须是非根目录的绝对路径。");
    }
    resolved.push(await realpath(configured));
  }
  return resolved;
}

export async function resolveLocalRepository(localRepositoryPath, allowedRoots) {
  if (typeof localRepositoryPath !== "string" || !path.isAbsolute(localRepositoryPath)) {
    throw new LocalGitError("invalid_repository", "本地仓库路径必须是绝对路径。");
  }
  let repositoryPath;
  try {
    repositoryPath = await realpath(localRepositoryPath);
  } catch {
    throw new LocalGitError("not_found", "本地仓库路径不存在。");
  }
  if (!allowedRoots.some((root) => withinRoot(repositoryPath, root))) {
    throw new LocalGitError("forbidden", "该路径不在 Runner 允许访问的仓库目录中。");
  }
  const info = await stat(repositoryPath);
  if (!info.isDirectory()) throw new LocalGitError("invalid_repository", "绑定路径不是目录。");
  const rootResult = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  if (rootResult.code !== 0) throw new LocalGitError("invalid_repository", "该目录不是合法 Git Repository。");
  const gitRoot = await realpath(rootResult.stdout.trim());
  if (gitRoot !== repositoryPath) {
    throw new LocalGitError("invalid_repository", "必须绑定 Git Repository 根目录，不能绑定其子目录。");
  }
  return repositoryPath;
}

function validateRemoteName(remoteName) {
  if (typeof remoteName !== "string" || !remotePattern.test(remoteName)) {
    throw new LocalGitError("invalid_repository", "Remote 名称无效。");
  }
  return remoteName;
}

function validateBranch(branch) {
  if (!branch || branch.length > 255 || branchUnsafePattern.test(branch)) {
    throw new LocalGitError("invalid_repository", "当前分支名称无效。");
  }
  return branch;
}

function parsePorcelain(output) {
  const records = output.split("\0");
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const indexStatus = record[0] || " ";
    const workTreeStatus = record[1] || " ";
    const pair = `${indexStatus}${workTreeStatus}`;
    changes.push({
      path: record.slice(3),
      indexStatus,
      workTreeStatus,
      conflicted: conflictStatuses.has(pair),
    });
    if (indexStatus === "R" || indexStatus === "C") index += 1;
  }
  return changes;
}

async function optionalGit(repositoryPath, args) {
  return runCommand("git", args, { cwd: repositoryPath, allowFailure: true });
}

async function detectDefaultBranch(repositoryPath, remoteName) {
  const symbolic = await optionalGit(repositoryPath, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`]);
  if (symbolic.code === 0) return symbolic.stdout.trim().replace(`${remoteName}/`, "") || null;
  for (const candidate of ["main", "master"]) {
    const result = await optionalGit(repositoryPath, ["show-ref", "--verify", `refs/remotes/${remoteName}/${candidate}`]);
    if (result.code === 0) return candidate;
  }
  return null;
}

async function commitsToPush(repositoryPath, remoteName, currentBranch, upstream) {
  const base = upstream || `${remoteName}/${currentBranch}`;
  const existsResult = await optionalGit(repositoryPath, ["rev-parse", "--verify", base]);
  if (existsResult.code !== 0) return [];
  const result = await optionalGit(repositoryPath, ["log", "--format=%H%x1f%s", "--max-count=50", `${base}..HEAD`]);
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, ...message] = line.split("\x1f");
    return { sha, message: message.join("\x1f") };
  });
}

export async function getRepositoryStatus(repositoryPath, remoteName = "origin") {
  validateRemoteName(remoteName);
  const [branchResult, headResult, messageResult, statusResult, remoteResult, upstreamResult, remotesResult] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: repositoryPath }),
    runCommand("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }),
    runCommand("git", ["log", "-1", "--format=%s"], { cwd: repositoryPath }),
    runCommand("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: repositoryPath }),
    optionalGit(repositoryPath, ["remote", "get-url", remoteName]),
    optionalGit(repositoryPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    optionalGit(repositoryPath, ["remote"]),
  ]);
  const currentBranch = validateBranch(branchResult.stdout.trim());
  const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : null;
  let ahead = 0;
  let behind = 0;
  let comparisonRef = upstream;
  if (!comparisonRef) {
    const remoteBranch = `${remoteName}/${currentBranch}`;
    const remoteBranchResult = await optionalGit(repositoryPath, ["rev-parse", "--verify", remoteBranch]);
    if (remoteBranchResult.code === 0) comparisonRef = remoteBranch;
  }
  if (comparisonRef) {
    const counts = await optionalGit(repositoryPath, ["rev-list", "--left-right", "--count", `HEAD...${comparisonRef}`]);
    if (counts.code === 0) {
      const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(left) ? left : 0;
      behind = Number.isFinite(right) ? right : 0;
    }
  }
  const changes = parsePorcelain(statusResult.stdout);
  return {
    repositoryName: path.basename(repositoryPath),
    localRepositoryPath: repositoryPath,
    currentBranch,
    headCommit: headResult.stdout.trim(),
    headMessage: messageResult.stdout.trim(),
    remoteName,
    remoteUrl: remoteResult.code === 0 ? redactCredentials(remoteResult.stdout.trim()) || null : null,
    availableRemotes: remotesResult.code === 0 ? remotesResult.stdout.split("\n").map((item) => item.trim()).filter(Boolean) : [],
    defaultBranch: await detectDefaultBranch(repositoryPath, remoteName),
    upstream,
    clean: changes.length === 0,
    ahead,
    behind,
    changes,
    conflicts: changes.filter((item) => item.conflicted).map((item) => item.path),
    commitsToPush: await commitsToPush(repositoryPath, remoteName, currentBranch, upstream),
  };
}

export async function getRepositoryDiff(repositoryPath) {
  const [summary, diff] = await Promise.all([
    runCommand("git", ["diff", "--stat", "HEAD"], { cwd: repositoryPath, allowFailure: true }),
    runCommand("git", ["diff", "--no-ext-diff", "--unified=3", "HEAD"], { cwd: repositoryPath, allowFailure: true }),
  ]);
  return { summary: summary.stdout, diff: diff.stdout };
}

export function assertSafeAction(action, confirmed) {
  if (["push --force", "push --force-with-lease", "reset --hard", "delete_remote_branch", "rebase_shared"].includes(action)) {
    throw new LocalGitError("high_risk_operation", "该操作属于高风险 Git 操作，Sugar Agent 当前不自动执行。");
  }
  if (!["fetch", "pull", "sync", "push", "commit"].includes(action)) {
    throw new LocalGitError("high_risk_operation", "该 Git 操作不在 Sugar Agent 允许列表中。");
  }
  if (confirmed !== true) {
    throw new LocalGitError("confirmation_required", `${action} 操作需要用户明确确认。`);
  }
}

export async function executeGitAction({ repositoryPath, remoteName = "origin", action, confirmed, commitMessage, commitPaths }) {
  assertSafeAction(action, confirmed);
  validateRemoteName(remoteName);
  const before = await getRepositoryStatus(repositoryPath, remoteName);
  let result;
  if (action === "commit") {
    const message = String(commitMessage || "").trim();
    if (!message || message.length > 200 || /[\r\n]/.test(message)) {
      throw new LocalGitError("invalid_repository", "Commit message 必须是 1–200 字的单行文本。");
    }
    if (before.clean) throw new LocalGitError("conflict", "当前没有可提交的修改。");
    const scopedPaths = Array.isArray(commitPaths) && commitPaths.length > 0
      ? [...new Set(commitPaths.map((item) => String(item).trim()).filter(Boolean))]
      : null;
    if (scopedPaths) {
      for (const relativePath of scopedPaths) {
        const absolutePath = path.resolve(repositoryPath, relativePath);
        if (!withinRoot(absolutePath, repositoryPath)) {
          throw new LocalGitError("forbidden", "提交文件逃逸仓库边界。");
        }
      }
    }
    const pathspecs = scopedPaths?.map((item) => `:(literal)${item}`) ?? [];
    await runCommand("git", ["add", "-A", "--", ...pathspecs], { cwd: repositoryPath });
    result = await runCommand("git", scopedPaths
      ? ["commit", "--only", "-m", message, "--", ...pathspecs]
      : ["commit", "-m", message], {
      cwd: repositoryPath,
      errorCode: "conflict",
      errorMessage: "Commit 失败，请检查 Git 用户配置或暂存状态。",
    });
  } else {
    if (!before.remoteUrl) throw new LocalGitError("not_found", `没有找到 remote：${remoteName}。`);
    if (["pull", "sync"].includes(action) && !before.clean) {
      throw new LocalGitError("dirty_worktree", `当前仓库存在未提交修改，不能 ${action === "sync" ? "同步主干" : "Pull"}。`, { status: before });
    }
    if (action === "sync") {
      const fetchResult = await runCommand("git", ["fetch", "--prune", remoteName], { cwd: repositoryPath, allowFailure: true });
      if (fetchResult.code !== 0) {
        throw new LocalGitError("conflict", "获取远端主干失败，尚未开始合并。", {
          status: await getRepositoryStatus(repositoryPath, remoteName),
          stderr: redactCredentials(fetchResult.stderr).slice(-2000),
        });
      }
      const fetchedStatus = await getRepositoryStatus(repositoryPath, remoteName);
      if (!fetchedStatus.defaultBranch) {
        throw new LocalGitError("not_found", `无法识别 ${remoteName} 的主干分支。`);
      }
      result = await runCommand("git", ["merge", "--no-edit", `${remoteName}/${fetchedStatus.defaultBranch}`], {
        cwd: repositoryPath,
        allowFailure: true,
      });
    } else {
      const args = action === "fetch"
        ? ["fetch", "--prune", remoteName]
        : action === "pull"
          ? ["pull", "--no-rebase", remoteName, before.currentBranch]
          : ["push", remoteName, before.currentBranch];
      result = await runCommand("git", args, { cwd: repositoryPath, allowFailure: true });
    }
  }
  const after = await getRepositoryStatus(repositoryPath, remoteName);
  if (result.code !== 0) {
    const message = ["pull", "sync"].includes(action) && after.conflicts.length
      ? `${action === "sync" ? "合并主干" : "Pull"}发生冲突，已停止自动操作：${after.conflicts.join("、")}`
      : `${action} 失败，未执行任何破坏性恢复操作。`;
    throw new LocalGitError("conflict", message, {
      status: after,
      stderr: redactCredentials(result.stderr).slice(-2000),
    });
  }
  return {
    action,
    success: true,
    message: action === "commit" ? "修改已保存到本地 Git。" : action === "sync" ? "远端主干已合并到当前分支。" : `${action} 已完成。`,
    status: after,
    ...(action === "commit" ? { commitSha: after.headCommit } : {}),
    ...(action === "commit" ? { committedFiles: Array.isArray(commitPaths) && commitPaths.length > 0 ? [...new Set(commitPaths)] : before.changes.map((item) => item.path) } : {}),
  };
}

export async function fingerprintPaths(repositoryPath, paths) {
  const fingerprints = new Map();
  for (const relativePath of paths) {
    const absolutePath = path.resolve(repositoryPath, relativePath);
    if (!withinRoot(absolutePath, repositoryPath)) {
      throw new LocalGitError("forbidden", "状态文件逃逸仓库边界。");
    }
    if (!(await exists(absolutePath))) {
      fingerprints.set(relativePath, "__missing__");
      continue;
    }
    const hash = await runCommand("git", ["hash-object", "--", relativePath], { cwd: repositoryPath, allowFailure: true });
    fingerprints.set(relativePath, hash.code === 0 ? hash.stdout.trim() : "__unreadable__");
  }
  return fingerprints;
}
