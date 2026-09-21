"use client";
/* eslint-disable @next/next/no-img-element -- user avatars are remote Supabase URLs */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RunnerDevicesSettings } from "./RunnerDevicesSettings";

type AccountData = {
  user: { email: string; lastSignInAt: string | null; createdAt: string };
  profile: { displayName: string; avatarUrl: string | null };
  memberships: Array<{ role: string; created_at: string; projects: { id: string; name: string; status: string } | Array<{ id: string; name: string; status: string }> | null }>;
  securityEvents: Array<{ id: string; event_type: string; summary: string; created_at: string }>;
};

type BusyAction = "profile" | "avatar" | "password" | "signout";

export function AccountSettings() {
  const router = useRouter();
  const [data, setData] = useState<AccountData>();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<BusyAction>();
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/account", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      setData(body);
      setName(body.profile.displayName);
    }
  }, []);

  useEffect(() => {
    const pending = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(pending);
  }, [load]);

  const saveProfile = async () => {
    setBusy("profile"); setNotice("正在保存个人资料…");
    try {
      const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name }) });
      const body = await response.json().catch(() => null);
      setNotice(response.ok ? "个人资料已保存" : body?.error || "保存失败");
      if (response.ok) await load();
    } catch { setNotice("网络异常，个人资料未保存"); }
    finally { setBusy(undefined); }
  };

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    setBusy("avatar"); setNotice("正在上传头像…");
    try {
      const form = new FormData(); form.set("avatar", file);
      const response = await fetch("/api/account/avatar", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      setNotice(response.ok ? "头像已更新" : body?.error || "上传失败");
      if (response.ok) await load();
    } catch { setNotice("网络异常，头像未上传"); }
    finally { setBusy(undefined); }
  };

  const changePassword = async () => {
    if (password !== confirm) { setNotice("两次输入的密码不一致"); return; }
    setBusy("password"); setNotice("正在更新密码…");
    try {
      const response = await fetch("/api/account/password", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json().catch(() => null);
      setNotice(response.ok ? "密码已更新" : body?.error || "更新失败");
      if (response.ok) { setPassword(""); setConfirm(""); await load(); }
    } catch { setNotice("网络异常，密码未更新"); }
    finally { setBusy(undefined); }
  };

  const signOutAll = async () => {
    if (!window.confirm("确认退出所有设备上的 Sugar Agent 登录？")) return;
    setBusy("signout"); setNotice("正在退出所有设备…");
    try {
      const response = await fetch("/api/account/sign-out-all", { method: "POST" });
      if (response.ok) { router.push("/"); router.refresh(); return; }
      setNotice("退出所有设备失败");
    } catch { setNotice("网络异常，退出操作未完成"); }
    setBusy(undefined);
  };

  if (!data) return <div role="status" className="p-10 text-body text-[#88877f]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在加载账户设置…</div>;

  return <div className="mx-auto grid max-w-[980px] grid-cols-[180px_1fr] gap-8 px-8 py-10"><aside><h1 className="text-[18px] font-semibold text-[#252521]">账户设置</h1><p className="mt-2 text-body leading-5 text-[#88877f]">个人资料、安全与项目权限</p></aside><div className="space-y-6">
    <section className="rounded-[10px] border border-[#e1e0db] bg-white p-5"><h2 className="text-body font-semibold">个人资料</h2><div className="mt-4 flex items-center gap-4">{data.profile.avatarUrl?<img src={data.profile.avatarUrl} alt="当前头像" className="h-14 w-14 rounded-full object-cover"/>:<span className="grid h-14 w-14 place-items-center rounded-full bg-[#ecece8] text-[16px]">{Array.from(name).slice(0,1)}</span>}<label aria-busy={busy === "avatar"} className={`rounded border border-[#d8d8d2] px-3 py-2 text-control ${busy ? "pointer-events-none opacity-45" : "cursor-pointer"}`}>{busy === "avatar" ? "头像上传中…" : "上传头像"}<input disabled={!!busy} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event)=>void uploadAvatar(event.target.files?.[0])}/></label></div><label className="mt-4 block text-control text-[#77766f]">显示姓名<input value={name} onChange={(event)=>setName(event.target.value)} className="mt-1.5 h-9 w-full max-w-sm rounded border border-[#d8d8d2] px-3 text-body outline-none"/></label><p className="mt-3 text-control text-[#999890]">登录邮箱：{data.user.email}</p><button aria-busy={busy === "profile"} onClick={()=>void saveProfile()} disabled={!!busy||!name.trim()} className="mt-4 h-8 rounded bg-[#29463a] px-3 text-control text-white disabled:opacity-35">{busy === "profile" ? "保存中…" : "保存资料"}</button></section>
    <section className="rounded-[10px] border border-[#e1e0db] bg-white p-5"><h2 className="text-body font-semibold">密码与登录会话</h2><p className="mt-2 text-control text-[#88877f]">最近登录：{data.user.lastSignInAt?new Date(data.user.lastSignInAt).toLocaleString("zh-CN"):"暂无记录"}</p><div className="mt-4 grid max-w-xl grid-cols-2 gap-2"><input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="新密码（至少 10 位）" className="h-9 rounded border border-[#d8d8d2] px-3 text-control"/><input type="password" value={confirm} onChange={(event)=>setConfirm(event.target.value)} placeholder="再次输入" className="h-9 rounded border border-[#d8d8d2] px-3 text-control"/></div><div className="mt-3 flex gap-2"><button aria-busy={busy === "password"} onClick={()=>void changePassword()} disabled={!!busy||password.length<10} className="h-8 rounded border border-[#d8d8d2] px-3 text-control disabled:opacity-35">{busy === "password" ? "更新中…" : "更新密码"}</button><button aria-busy={busy === "signout"} onClick={()=>void signOutAll()} disabled={!!busy} className="h-8 rounded border border-[#ead8d2] px-3 text-control text-[#925c4e] disabled:opacity-35">{busy === "signout" ? "正在退出…" : "退出所有设备"}</button></div></section>
    <RunnerDevicesSettings />
    <section className="rounded-[10px] border border-[#e1e0db] bg-white p-5"><h2 className="text-body font-semibold">项目权限审计</h2><p className="mt-1 text-control text-[#88877f]">负责人和成员目前拥有完全相同的项目数据权限；角色只作身份展示。</p><div className="mt-3 divide-y divide-[#eeeeea]">{data.memberships.map((membership,index)=>{const project=Array.isArray(membership.projects)?membership.projects[0]:membership.projects;return project?<div key={`${project.id}-${index}`} className="flex py-2.5 text-control"><span>{project.name}</span><span className="ml-auto text-[#88877f]">{membership.role==="project_lead"?"项目负责人":"项目成员"} · {project.status}</span></div>:null;})}</div></section>
    <section className="rounded-[10px] border border-[#e1e0db] bg-white p-5"><h2 className="text-body font-semibold">安全记录</h2><div className="mt-3 space-y-2">{data.securityEvents.length?data.securityEvents.map((event)=><div key={event.id} className="flex gap-4 text-control"><time className="w-36 shrink-0 text-[#999890]">{new Date(event.created_at).toLocaleString("zh-CN")}</time><span className="text-[#55564f]">{event.summary}</span></div>):<p className="text-control text-[#999890]">暂无账户安全变更。</p>}</div></section>
    {notice&&<p role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded bg-[#29463a] px-4 py-2 text-body text-white">{notice}</p>}
  </div></div>;
}
