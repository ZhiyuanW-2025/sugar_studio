"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Project } from "./types";

type Member = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: "project_lead" | "member";
  createdAt: string;
};

type Props = {
  project: Project;
  currentUserEmail: string;
  onClose: () => void;
  onUpdated: (project: Project) => void;
  onNotice: (message: string) => void;
};

const readPayload = (response: Response) => response.json().catch(() => null) as Promise<{
  project?: Project;
  members?: Member[];
  ok?: boolean;
  invited?: boolean;
  error?: string;
} | null>;

export function ProjectSettingsModal({ project, currentUserEmail, onClose, onUpdated, onNotice }: Props) {
  const [tab, setTab] = useState<"general" | "members">("general");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"project_lead" | "member">("member");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/members`, { cache: "no-store" });
      const payload = await readPayload(response);
      if (!response.ok || !payload?.members) throw new Error(payload?.error || "成员列表加载失败。");
      setMembers(payload.members);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "成员列表加载失败。");
    } finally {
      setLoadingMembers(false);
    }
  }, [project.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const updateProject = async (updates: Record<string, string>) => {
    const action = updates.status ? "project-status" : "project-save";
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload?.project) throw new Error(payload?.error || "项目更新失败。");
      onUpdated(payload.project);
      setName(payload.project.name);
      setDescription(payload.project.description);
      onNotice(updates.status === "archived" ? "项目已归档" : updates.status === "active" ? "项目已恢复" : "项目设置已保存");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "项目更新失败。");
    } finally {
      setBusy(null);
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy("add-member");
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role: newRole }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "添加成员失败。");
      setEmail("");
      onNotice(payload.invited ? "邀请邮件已发送；受邀用户已加入项目" : "项目成员已添加");
      await loadMembers();
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : "添加成员失败。");
    } finally {
      setBusy(null);
    }
  };

  const updateMember = async (member: Member, method: "PATCH" | "DELETE", role?: Member["role"]) => {
    if (busy) return;
    if (method === "DELETE" && !window.confirm(`确认将「${member.displayName}」移出当前项目？`)) return;
    setBusy(member.id);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/members/${member.id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ role }) : undefined,
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "成员操作失败。");
      onNotice(method === "DELETE" ? "项目成员已移除" : "成员身份已更新");
      await loadMembers();
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : "成员操作失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" aria-label="关闭项目设置" disabled={busy !== null} onClick={onClose} className="fixed inset-0 z-50 cursor-default bg-[#161613]/20 disabled:cursor-wait" />
      <section role="dialog" aria-modal="true" aria-label="项目设置" className="panel-in fixed left-1/2 top-1/2 z-[60] flex max-h-[82vh] w-[620px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] border border-[#deddd8] bg-white shadow-[0_24px_80px_rgba(20,20,16,0.2)]">
        <header className="flex h-16 shrink-0 items-center border-b border-[#e8e7e2] px-5">
          <div>
            <h2 className="text-panel-title font-semibold text-[#292925]">项目设置</h2>
            <p className="mt-1 text-control text-[#999890]">{project.name} · {project.role === "project_lead" ? "项目负责人" : "项目成员"}</p>
          </div>
          <button type="button" disabled={busy !== null} onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0] disabled:opacity-40">×</button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="w-[150px] shrink-0 border-r border-[#ecebe7] bg-[#f8f8f5] p-3">
            {([['general', '基本信息'], ['members', '项目成员']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => { setTab(id); setError(null); if (id === "members") void loadMembers(); }} className={`mb-1 h-9 w-full rounded-md px-3 text-left text-body ${tab === id ? "bg-white font-medium text-[#34342f] shadow-sm" : "text-[#77766f] hover:bg-white/70"}`}>{label}</button>
            ))}
          </nav>
          <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-6">
            {tab === "general" ? (
              <div>
                <h3 className="text-body font-semibold text-[#34342f]">基本信息</h3>
                <label className="mt-5 block text-control font-medium text-[#77766f]">项目名称
                  <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-[#d8d7d1] px-3 text-body outline-none focus:border-[#9aa9a1]" />
                </label>
                <label className="mt-4 block text-control font-medium text-[#77766f]">项目简介
                  <textarea value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-1.5 w-full resize-y rounded-md border border-[#d8d7d1] px-3 py-2.5 text-body leading-5 outline-none focus:border-[#9aa9a1]" />
                </label>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" aria-busy={busy === "project-save"} disabled={busy !== null || !name.trim()} onClick={() => void updateProject({ name: name.trim(), description: description.trim() })} className="h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white disabled:opacity-40">{busy === "project-save" ? "保存中…" : "保存修改"}</button>
                  <button type="button" aria-busy={busy === "project-status"} disabled={busy !== null} onClick={() => void updateProject({ status: project.status === "archived" ? "active" : "archived" })} className="h-8 rounded-md border border-[#deddd7] px-3 text-control text-[#77766f] disabled:opacity-40">{busy === "project-status" ? "处理中…" : project.status === "archived" ? "恢复项目" : "归档项目"}</button>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-body font-semibold text-[#34342f]">项目成员</h3>
                <p className="mt-1 text-control leading-4 text-[#999890]">负责人和成员当前拥有相同项目权限，身份仅用于展示。</p>
                <form onSubmit={addMember} className="mt-4 flex gap-2">
                  <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱；未注册会发送邀请" className="h-8 min-w-0 flex-1 rounded-md border border-[#d8d7d1] px-2.5 text-control outline-none" />
                  <select value={newRole} onChange={(event) => setNewRole(event.target.value as Member["role"])} className="h-8 rounded-md border border-[#d8d7d1] bg-white px-2 text-control"><option value="member">项目成员</option><option value="project_lead">项目负责人</option></select>
                  <button type="submit" aria-busy={busy === "add-member"} disabled={busy !== null || !email.trim()} className="h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white disabled:opacity-40">{busy === "add-member" ? "添加中…" : "添加"}</button>
                </form>
                <div className="mt-5 divide-y divide-[#ecebe7] border-y border-[#ecebe7]">
                  {loadingMembers ? <p className="py-5 text-control text-[#999890]">正在读取成员…</p> : members.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 py-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#efefeb] text-control font-semibold text-[#66665f]">{Array.from(member.displayName).slice(0, 1)}</span>
                      <div className="min-w-0 flex-1"><p className="truncate text-body font-medium text-[#44443f]">{member.displayName}{member.email.toLowerCase() === currentUserEmail.toLowerCase() ? "（你）" : ""}</p><p className="mt-0.5 truncate text-caption text-[#999890]">{member.email}</p></div>
                      <select value={member.role} aria-busy={busy === member.id} disabled={busy !== null} onChange={(event) => void updateMember(member, "PATCH", event.target.value as Member["role"])} className="h-7 rounded-md border border-[#deddd7] bg-white px-1.5 text-caption"><option value="member">成员</option><option value="project_lead">负责人</option></select>
                      <button type="button" aria-busy={busy === member.id} disabled={busy !== null} onClick={() => void updateMember(member, "DELETE")} className="h-7 px-1.5 text-caption text-[#98665c] disabled:opacity-40">{busy === member.id ? "处理中…" : "移除"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && <p role="alert" className="mt-4 rounded-md bg-[#fbf3ef] px-3 py-2 text-control text-[#895c49]">{error}</p>}
          </div>
        </div>
      </section>
    </>
  );
}
