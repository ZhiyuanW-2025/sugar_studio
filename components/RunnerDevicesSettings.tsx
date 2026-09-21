"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Device = {
  id: string;
  name: string;
  platform: string | null;
  app_version: string | null;
  status: "active" | "revoked";
  paired_at: string;
  last_seen_at: string | null;
};

export function RunnerDevicesSettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(0);
  const downloadUrl = process.env.NEXT_PUBLIC_SUGAR_RUNNER_DOWNLOAD_URL;

  const load = useCallback(async () => {
    const response = await fetch("/api/runner/devices", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) setDevices(body.devices || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setClock(Date.now()); void load(); }, 0);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(clockTimer); };
  }, [load]);

  const activeDevices = useMemo(() => devices.filter((device) => device.status === "active"), [devices]);

  const createPairing = async () => {
    setBusy("pairing"); setNotice("正在生成一次性配对码…");
    try {
      const response = await fetch("/api/runner/pairing", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "配对码生成失败");
      setPairing(body);
      setNotice("配对码已生成，请在 10 分钟内填入 Sugar Runner。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "配对码生成失败");
    } finally { setBusy(undefined); }
  };

  const revoke = async (device: Device) => {
    if (!window.confirm(`确认停用“${device.name}”上的 Sugar Runner？`)) return;
    setBusy(device.id); setNotice("正在停用设备…");
    try {
      const response = await fetch(`/api/runner/devices/${device.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "设备停用失败");
      await load(); setNotice("设备已停用。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "设备停用失败");
    } finally { setBusy(undefined); }
  };

  const online = (device: Device) => Boolean(device.last_seen_at && clock - new Date(device.last_seen_at).getTime() < 120_000);

  return <section className="rounded-[10px] border border-[#e1e0db] bg-white p-5">
    <div className="flex items-start justify-between gap-5">
      <div><h2 className="text-body font-semibold">Sugar Runner 本地助手</h2><p className="mt-1 text-control text-[#88877f]">配对这台 Mac 后，在各项目的“代码仓库”中绑定牛牛需要使用的精确 Git 仓库。</p></div>
      {downloadUrl ? <a href={downloadUrl} className="shrink-0 rounded border border-[#cfd8d2] px-3 py-2 text-control font-medium text-[#315d4d]">下载 macOS 版</a> : <span className="shrink-0 rounded bg-[#f1f1ed] px-3 py-2 text-control text-[#898981]">macOS 安装包待发布</span>}
    </div>

    <div className="mt-4 rounded-[8px] bg-[#f7f8f5] p-4">
      <ol className="grid gap-2 text-control text-[#5f6059] sm:grid-cols-2"><li><strong className="mr-1 text-[#33342f]">1.</strong>安装并打开 Sugar Runner</li><li><strong className="mr-1 text-[#33342f]">2.</strong>生成一次性配对码并完成连接</li></ol>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={Boolean(busy)} onClick={() => void createPairing()} className="h-9 rounded bg-[#29463a] px-4 text-control font-medium text-white disabled:opacity-40">{busy === "pairing" ? "生成中…" : "生成配对码"}</button>
        {pairing && <div className="rounded border border-[#cfd8d2] bg-white px-4 py-2 font-mono text-[18px] tracking-[0.18em] text-[#29463a]" aria-label="Sugar Runner 配对码">{pairing.code}</div>}
        {pairing && <span className="text-caption text-[#999890]">10 分钟内有效</span>}
      </div>
    </div>

    <div className="mt-4"><h3 className="text-control font-semibold text-[#55564f]">已配对设备</h3>{activeDevices.length === 0 ? <p className="mt-2 text-control text-[#999890]">尚未连接任何电脑。配对成功后，牛牛才能使用该电脑上的仓库。</p> : <div className="mt-2 divide-y divide-[#eeeeea]">{activeDevices.map((device) => <div key={device.id} className="flex items-center gap-3 py-3 text-control"><span className={`h-2 w-2 rounded-full ${online(device) ? "bg-[#4f9a71]" : "bg-[#b8b8b1]"}`} /><div><p className="font-medium text-[#44453f]">{device.name}</p><p className="mt-0.5 text-caption text-[#999890]">{device.platform || "Mac"} · {online(device) ? "在线" : device.last_seen_at ? `上次连接 ${new Date(device.last_seen_at).toLocaleString("zh-CN")}` : "尚未上线"}</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void revoke(device)} className="ml-auto rounded border border-[#e3d7d2] px-3 py-1.5 text-control text-[#925c4e] disabled:opacity-40">{busy === device.id ? "停用中…" : "停用"}</button></div>)}</div>}</div>
    {notice && <p role="status" aria-live="polite" className="mt-3 text-control text-[#667c70]">{notice}</p>}
  </section>;
}
