import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile, chmod } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const appVersion = "1.0.0";
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.SUGAR_RUNNER_DATA_DIR
  ? path.resolve(process.env.SUGAR_RUNNER_DATA_DIR)
  : path.join(homedir(), "Library", "Application Support", "Sugar Runner");
const configPath = path.join(dataDirectory, "config.json");
const uiHost = "127.0.0.1";
const uiPort = Number(process.env.SUGAR_RUNNER_DESKTOP_PORT || 4392);
const corePort = Number(process.env.SUGAR_RUNNER_CORE_PORT || 4393);
let config = null;
let coreProcess = null;
let polling = false;
let pollTimer = null;
let status = { state: "setup", message: "等待配对", lastSeenAt: null };

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeJson = (response, code, payload) => {
  response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
};

async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed.cloudUrl || !parsed.deviceToken || !Array.isArray(parsed.allowedRoots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveConfig(next) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, configPath);
}

function normalizeCloudUrl(value) {
  const parsed = new URL(String(value || "").trim());
  const isLocal = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error("线上地址必须使用 HTTPS；本地测试可使用 localhost。");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function validateRoots(values) {
  const roots = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
  if (!roots.length) throw new Error("请至少选择一个允许 Sugar Runner 访问的代码目录。");
  for (const root of roots) {
    if (!path.isAbsolute(root) || root === path.parse(root).root) throw new Error("代码目录必须是非根目录的绝对路径。");
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`目录不存在：${root}`);
  }
  return roots;
}

function stopCore() {
  if (coreProcess && !coreProcess.killed) coreProcess.kill("SIGTERM");
  coreProcess = null;
}

async function startCore() {
  stopCore();
  if (!config) return;
  coreProcess = spawn(process.execPath, [path.join(appDirectory, "server.mjs")], {
    env: {
      ...process.env,
      SUGAR_CODEX_RUNNER_HOST: "127.0.0.1",
      SUGAR_CODEX_RUNNER_PORT: String(corePort),
      SUGAR_CODEX_RUNNER_SECRET: config.localSecret,
      SUGAR_LOCAL_REPOSITORY_ROOTS: config.allowedRoots.join(path.delimiter),
      SUGAR_RUNNER_ISOLATED: "true",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  coreProcess.once("exit", () => {
    coreProcess = null;
    if (config) status = { ...status, state: "error", message: "本地执行服务已停止，请重新打开 Sugar Runner。" };
  });
  await sleep(500);
}

async function sendCompletion(jobId, responseStatus, responseBody) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${config.cloudUrl}/api/runner/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.deviceToken}` },
        body: JSON.stringify({ responseStatus, responseBody }),
      });
      if (response.ok || response.status === 409) return;
    } catch {
      // Retry without logging task data or credentials.
    }
    await sleep(800 * (attempt + 1));
  }
}

async function executeJob(job) {
  let responseStatus = 502;
  let responseBody = { error: "Sugar Runner 无法调用本地执行服务。", code: "runner_unavailable" };
  try {
    const localResponse = await fetch(`http://127.0.0.1:${corePort}${job.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.localSecret}` },
      body: JSON.stringify(job.body),
    });
    responseStatus = localResponse.status;
    responseBody = await localResponse.json().catch(() => ({ error: "本地执行服务返回了无效响应。", code: "invalid_response" }));
  } catch {
    responseBody = { error: "Sugar Runner 本地执行服务未响应。", code: "runner_unavailable" };
  }
  await sendCompletion(job.jobId, responseStatus, responseBody);
}

async function pollOnce() {
  if (!config || polling) return;
  polling = true;
  try {
    const response = await fetch(`${config.cloudUrl}/api/runner/poll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.deviceToken}` },
    });
    const now = new Date().toISOString();
    if (response.status === 204) {
      status = { state: "online", message: "已连接，等待任务", lastSeenAt: now };
      return;
    }
    if (response.status === 401) {
      status = { state: "error", message: "设备配对已失效，请重新配对。", lastSeenAt: now };
      return;
    }
    if (!response.ok) {
      status = { state: "error", message: "暂时无法连接 Sugar Agent。", lastSeenAt: status.lastSeenAt };
      return;
    }
    const job = await response.json();
    status = { state: "working", message: "正在执行来自 Sugar Agent 的任务", lastSeenAt: now };
    await executeJob(job);
    status = { state: "online", message: "任务已完成，等待下一项", lastSeenAt: new Date().toISOString() };
  } catch {
    status = { state: "error", message: "网络连接中断，正在自动重试。", lastSeenAt: status.lastSeenAt };
  } finally {
    polling = false;
  }
}

function schedulePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void pollOnce(), 3_000);
  void pollOnce();
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 100_000) throw new Error("请求过大。");
  }
  return JSON.parse(text || "{}");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function page() {
  const connected = Boolean(config);
  const roots = connected ? config.allowedRoots.join("\n") : path.join(homedir(), "Projects");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sugar Runner</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#242521;background:#f4f4f0}*{box-sizing:border-box}body{margin:0}.shell{max-width:760px;margin:56px auto;padding:0 24px}.brand{display:flex;align-items:center;gap:13px}.logo{width:44px;height:44px;border-radius:12px;background:#243f34;color:white;display:grid;place-items:center;font-weight:700}.card{margin-top:28px;background:white;border:1px solid #deded8;border-radius:14px;padding:24px;box-shadow:0 12px 40px rgba(40,42,36,.06)}h1{font-size:22px;margin:0}h2{font-size:17px;margin:0 0 8px}p{color:#74756e;line-height:1.6;margin:6px 0}.state{display:flex;gap:10px;align-items:center;padding:14px;border-radius:10px;background:#f4f7f5}.dot{width:9px;height:9px;border-radius:50%;background:${status.state === "online" ? "#4f9a71" : status.state === "working" ? "#d2a53f" : status.state === "error" ? "#bf6257" : "#8099ac"}}label{display:block;margin-top:17px;font-size:13px;color:#5d5e57}input,textarea{margin-top:7px;width:100%;border:1px solid #d8d8d1;border-radius:9px;padding:11px 12px;font:inherit;outline:none}input:focus,textarea:focus{border-color:#758d81}button{margin-top:18px;border:0;border-radius:9px;background:#243f34;color:white;font-size:14px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.5}.fine{font-size:12px}.hidden{display:none}.notice{margin-top:13px;font-size:13px;color:#8e5549}</style></head><body><main class="shell"><div class="brand"><div class="logo">S</div><div><h1>Sugar Runner</h1><p class="fine">让工程师牛牛安全使用这台 Mac 上的代码仓库</p></div></div><section class="card"><div class="state"><span class="dot"></span><div><strong id="statusTitle">${connected ? escapeHtml(config.deviceName) : "尚未配对"}</strong><p id="statusText" class="fine">${escapeHtml(status.message)}</p></div></div><div id="setup" class="${connected ? "hidden" : ""}"><h2 style="margin-top:24px">连接 Sugar Agent</h2><p>在 Sugar Agent 的“账户设置 → Sugar Runner”生成配对码，然后填在这里。</p><label>Sugar Agent 网站地址<input id="cloudUrl" placeholder="https://agent.your-studio.com" value="${escapeHtml(process.env.SUGAR_AGENT_URL || "http://localhost:3000")}"></label><label>8 位配对码<input id="pairingCode" inputmode="numeric" placeholder="1234 5678"></label><label>这台电脑的名称<input id="deviceName" value="${escapeHtml(hostname())}"></label><label>允许访问的代码目录（每行一个）<textarea id="roots" rows="4">${escapeHtml(roots)}</textarea></label><button id="pair">连接本地助手</button><p id="notice" class="notice"></p></div><div id="connected" class="${connected ? "" : "hidden"}"><h2 style="margin-top:24px">已允许访问的目录</h2><p style="white-space:pre-line">${escapeHtml(roots)}</p><p class="fine">关闭窗口不会停止服务；退出 Sugar Runner 后，牛牛将不能访问这台电脑。</p><button id="open" type="button">打开 Sugar Agent</button></div></section></main><script>
const q=(id)=>document.getElementById(id);q('pair')?.addEventListener('click',async()=>{q('pair').disabled=true;q('notice').textContent='正在配对…';try{const response=await fetch('/api/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cloudUrl:q('cloudUrl').value,code:q('pairingCode').value,deviceName:q('deviceName').value,allowedRoots:q('roots').value.split('\\n')})});const body=await response.json();if(!response.ok)throw new Error(body.error||'配对失败');location.reload()}catch(error){q('notice').textContent=error.message;q('pair').disabled=false}});q('open')?.addEventListener('click',()=>window.open(${JSON.stringify(config?.cloudUrl || "http://localhost:3000")},'_blank'));setInterval(async()=>{try{const body=await fetch('/api/status').then(r=>r.json());q('statusText').textContent=body.message}catch{}},1500);
</script></body></html>`;
}

const uiServer = createServer(async (request, response) => {
  if (request.socket.remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
    return safeJson(response, 403, { error: "仅允许本机访问。" });
  }
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(page());
  }
  if (request.method === "GET" && request.url === "/api/status") return safeJson(response, 200, status);
  if (request.method === "POST" && request.url === "/api/configure") {
    try {
      const body = await readBody(request);
      const cloudUrl = normalizeCloudUrl(body.cloudUrl);
      const allowedRoots = await validateRoots(body.allowedRoots || []);
      const pairingResponse = await fetch(`${cloudUrl}/api/runner/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: body.code,
          deviceName: String(body.deviceName || hostname()).trim(),
          platform: `${platform()}-${process.arch}`,
          appVersion,
        }),
      });
      const paired = await pairingResponse.json().catch(() => null);
      if (!pairingResponse.ok || !paired?.deviceToken) throw new Error(paired?.error || "配对失败。");
      config = {
        cloudUrl,
        deviceId: paired.deviceId,
        deviceName: paired.deviceName,
        deviceToken: paired.deviceToken,
        localSecret: randomBytes(32).toString("base64url"),
        allowedRoots,
      };
      await saveConfig(config);
      await startCore();
      status = { state: "online", message: "已连接，等待任务", lastSeenAt: new Date().toISOString() };
      schedulePolling();
      return safeJson(response, 200, { connected: true });
    } catch (error) {
      return safeJson(response, 400, { error: error instanceof Error ? error.message : "配置失败。" });
    }
  }
  return safeJson(response, 404, { error: "Not found." });
});

config = await loadConfig();
if (config) {
  await startCore();
  status = { state: "online", message: "正在连接 Sugar Agent…", lastSeenAt: null };
  schedulePolling();
}
uiServer.listen(uiPort, uiHost, () => {
  const url = `http://${uiHost}:${uiPort}`;
  process.stdout.write(`Sugar Runner control panel: ${url}\n`);
  if (process.env.SUGAR_RUNNER_NO_OPEN !== "true") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (pollTimer) clearInterval(pollTimer);
    stopCore();
    uiServer.close();
    await rm(path.join(dataDirectory, ".lock"), { force: true }).catch(() => undefined);
    process.exit(0);
  });
}
