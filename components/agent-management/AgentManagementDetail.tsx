"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";
import {
  providerOptions,
  type AgentModelPreference,
  type ModelConfigSummary,
} from "../../lib/model-config/catalog";
import { AgentTestPanel, type AgentTestProject } from "./AgentTestPanel";
import { AgentAvatar, refreshAgentAvatars, useAgentAvatarUrl } from "../AgentAvatar";
import { AgentSkillManager } from "./AgentSkillManager";
import { AgentToolManager } from "./AgentToolManager";
import { AgentKnowledgeManager } from "./AgentKnowledgeManager";

type Props = { agent: AgentDefinition; projects: AgentTestProject[] };
type Tab = "basic" | "prompt" | "skills" | "tools" | "knowledge" | "model" | "test";

const tabs: { id: Tab; label: string }[] = [
  { id: "basic", label: "基本信息" },
  { id: "prompt", label: "提示词" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "工具" },
  { id: "knowledge", label: "知识" },
  { id: "model", label: "模型" },
  { id: "test", label: "测试" },
];

const modelLabel = (config: ModelConfigSummary) => {
  const provider = providerOptions.find((item) => item.value === config.provider);
  const model = provider?.models.find((item) => item.value === config.model);
  return `${provider?.label ?? config.provider} · ${model?.label ?? config.model}`;
};

type PromptVersion = {
  id: string;
  version: number;
  instructions: string;
  isActive: boolean;
  creatorName: string;
  createdAt: string;
};

export function AgentManagementDetail({ agent, projects }: Props) {
  const [tab, setTab] = useState<Tab>("basic");
  const [configs, setConfigs] = useState<ModelConfigSummary[]>([]);
  const [preference, setPreference] = useState<AgentModelPreference>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarUrl = useAgentAvatarUrl(agent.type);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/model-settings", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { configs?: ModelConfigSummary[]; preferences?: AgentModelPreference[]; error?: string }
          | null;
        if (!response.ok || !payload?.configs || !payload.preferences) {
          throw new Error(payload?.error || "暂时无法读取模型设置。");
        }
        if (!cancelled) {
          setConfigs(payload.configs);
          setPreference(payload.preferences.find((item) => item.agentType === agent.type));
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "暂时无法读取模型设置。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.type]);

  const loadPrompts = async () => {
    setPromptLoading(true);
    const response = await fetch(
      `/api/agents/prompts?agentType=${agent.type}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => null)) as
      | { versions?: PromptVersion[]; error?: string }
      | null;
    setPromptLoading(false);
    if (!response.ok || !payload?.versions) {
      setError(payload?.error || "暂时无法读取提示词版本。");
      return;
    }
    setPromptVersions(payload.versions);
    setPromptDraft(payload.versions.find((item) => item.isActive)?.instructions ?? "");
  };

  useEffect(() => {
    // Loading remote prompt state is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPrompts();
    // Prompt state is workspace-global and keyed only by the Agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.type]);

  const updatePreference = async (modelConfigId: string) => {
    setSaving(true);
    setError(undefined);
    const response = await fetch("/api/model-settings/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: agent.type, modelConfigId: modelConfigId || null }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error || "更新模型偏好失败。");
      return;
    }
    setPreference(modelConfigId ? { agentType: agent.type, modelConfigId } : undefined);
    setNotice("模型偏好已更新");
    window.setTimeout(() => setNotice(undefined), 2200);
  };

  const savePrompt = async () => {
    if (!promptDraft.trim() || promptSaving) return;
    setPromptSaving(true);
    setError(undefined);
    const response = await fetch("/api/agents/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: agent.type, action: "save", instructions: promptDraft }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPromptSaving(false);
    if (!response.ok) {
      setError(payload?.error || "保存提示词失败。");
      return;
    }
    setNotice("已创建新的提示词版本");
    window.setTimeout(() => setNotice(undefined), 2200);
    await loadPrompts();
  };

  const rollbackPrompt = async (version: number) => {
    if (promptSaving || !window.confirm(`确认回滚到 v${version}？系统会保留全部历史并创建一个新版本。`)) return;
    setPromptSaving(true);
    setError(undefined);
    const response = await fetch("/api/agents/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: agent.type, action: "rollback", version }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPromptSaving(false);
    if (!response.ok) {
      setError(payload?.error || "回滚提示词失败。");
      return;
    }
    setNotice(`已回滚到 v${version} 的内容`);
    window.setTimeout(() => setNotice(undefined), 2200);
    await loadPrompts();
  };

  const uploadAvatar = async (file: File) => {
    if (avatarSaving) return;
    setAvatarSaving(true);
    setError(undefined);
    const form = new FormData();
    form.set("avatar", file);
    const response = await fetch(`/api/agents/avatars/${agent.type}`, { method: "POST", body: form });
    const payload = await response.json().catch(() => null) as { avatarUrl?: string; error?: string } | null;
    setAvatarSaving(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    if (!response.ok || !payload?.avatarUrl) {
      setError(payload?.error || "头像上传失败。");
      return;
    }
    await refreshAgentAvatars();
    setNotice("Agent 头像已更新，所有项目将使用新头像");
    window.setTimeout(() => setNotice(undefined), 2200);
  };

  const resetAvatar = async () => {
    if (!avatarUrl || avatarSaving) return;
    setAvatarSaving(true);
    setError(undefined);
    const response = await fetch(`/api/agents/avatars/${agent.type}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { reset?: boolean; error?: string } | null;
    setAvatarSaving(false);
    if (!response.ok || !payload?.reset) {
      setError(payload?.error || "恢复默认头像失败。");
      return;
    }
    await refreshAgentAvatars();
    setNotice("已恢复默认文字头像");
    window.setTimeout(() => setNotice(undefined), 2200);
  };

  return (
    <div className={`mx-auto w-full px-8 py-10 ${tab === "test" ? "max-w-[1480px]" : "max-w-[920px]"}`}>
      <div className="flex items-start gap-4">
        <AgentAvatar agentType={agent.type} initials={agent.initials} className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#dfded8] bg-[#f7f7f4] text-body font-semibold text-[#55554f]" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[24px] font-semibold tracking-[-0.04em]">{agent.name}</h1>
            <span className="rounded border border-[#e4e3de] px-2 py-0.5 text-control text-[#77766f]">{agent.roleTitle}</span>
          </div>
          <p className="mt-1 text-body text-[#85847c]">{agent.description}</p>
        </div>
      </div>

      <div className="mt-8 flex gap-1 border-b border-[#deddd7]">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-3 py-2.5 text-body ${tab === item.id ? "border-[#34342f] font-medium text-[#34342f]" : "border-transparent text-[#929189] hover:text-[#55554f]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="py-7">
        {tab === "basic" && (
          <div>
            <section className="mb-7 rounded-[9px] border border-[#deddd7] bg-white p-4">
              <div className="flex items-center gap-4">
                <AgentAvatar agentType={agent.type} initials={agent.initials} className="grid h-20 w-20 shrink-0 place-items-center rounded-[14px] border border-[#dfded8] bg-[#f7f7f4] text-[18px] font-semibold text-[#55554f]" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-panel-title font-semibold text-[#34342f]">Agent 头像</h2>
                  <p className="mt-1 text-body leading-5 text-[#898880]">全局配置。更新后，所有项目中的标签、消息和 Agent 入口都会使用这张头像。</p>
                  <div className="mt-3 flex items-center gap-2">
                    <label className={`flex h-8 cursor-pointer items-center rounded-[6px] bg-[#243f34] px-3 text-control font-medium text-white ${avatarSaving ? "pointer-events-none opacity-50" : ""}`}>
                      {avatarSaving ? "正在保存…" : avatarUrl ? "更换头像" : "上传头像"}
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={avatarSaving}
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadAvatar(file);
                        }}
                      />
                    </label>
                    {avatarUrl && <button type="button" disabled={avatarSaving} onClick={() => void resetAvatar()} className="h-8 rounded-[6px] border border-[#d8d7d1] px-3 text-control text-[#66665f] disabled:opacity-40">恢复默认头像</button>}
                  </div>
                  <p className="mt-2 text-caption text-[#aaa9a1]">支持 PNG、JPG、WebP，最大 5 MB；建议使用正方形图片。</p>
                </div>
              </div>
              {error && <p role="alert" className="mt-3 text-body text-[#98584b]">{error}</p>}
            </section>
            <dl className="divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">
              {[["Agent 名称", agent.name], ["职位", agent.roleTitle], ["简介", agent.description]].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[150px_1fr] py-4 text-body">
                  <dt className="text-[#929189]">{label}</dt>
                  <dd className="text-[#44443f]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {tab === "prompt" && (
          <div>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-panel-title font-semibold">运行提示词</h2>
                <p className="mt-1 text-body text-[#898880]">每次保存创建新版本；当前 Agent 优先使用数据库中的 active 版本。</p>
              </div>
              {promptVersions.find((item) => item.isActive) && (
                <span className="text-control text-[#4f7566]">当前 v{promptVersions.find((item) => item.isActive)?.version}</span>
              )}
            </div>
            <div className="mt-4 rounded-[7px] border border-[#dde5e0] bg-[#f3f7f5] px-3.5 py-3 text-body leading-5 text-[#53675c]">
              此提示词为全局配置，修改后将影响所有项目中的该 Agent。
            </div>
            {error && <p role="alert" className="mt-4 text-body text-[#98584b]">{error}</p>}
            {promptLoading ? (
              <p className="py-8 text-body text-[#999890]">正在读取提示词…</p>
            ) : (
              <>
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  rows={15}
                  placeholder="尚未配置数据库提示词；Agent 将使用代码内安全 fallback。"
                  className="mt-5 w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-4 py-3 font-mono text-body leading-6 text-[#44443f] outline-none focus:border-[#879e93]"
                />
                <div className="mt-3 flex justify-end">
                  <button type="button" aria-busy={promptSaving} disabled={promptSaving || !promptDraft.trim()} onClick={() => void savePrompt()} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white disabled:opacity-50">
                    {promptSaving ? "正在保存…" : "保存为新版本"}
                  </button>
                </div>
                <h3 className="mt-8 text-body font-semibold text-[#55554f]">版本历史</h3>
                {promptVersions.length === 0 ? (
                  <p className="mt-3 border-l-2 border-[#d8ddd9] py-1 pl-3 text-body text-[#999890]">暂无数据库版本，当前使用代码内 fallback。</p>
                ) : (
                  <div className="mt-3 divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">
                    {promptVersions.map((version) => (
                      <div key={version.id} className="flex items-center gap-3 py-3 text-body">
                        <span className="w-10 font-mono text-[#55554f]">v{version.version}</span>
                        <span className="flex-1 text-[#929189]">{version.creatorName} · {new Date(version.createdAt).toLocaleString("zh-CN")}</span>
                        {version.isActive ? (
                          <span className="text-[#3f6b5a]">当前使用</span>
                        ) : (
                          <button type="button" aria-busy={promptSaving} disabled={promptSaving} onClick={() => void rollbackPrompt(version.version)} className="text-[#66665f] hover:text-[#243f34]">{promptSaving ? "正在回滚…" : "回滚到此版本"}</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "model" && (
          <div>
            <h2 className="text-panel-title font-semibold">模型偏好</h2>
            <p className="mt-1 text-body text-[#898880]">只影响你自己的 {agent.name}；不重新填写 API Key。</p>
            {error && <p role="alert" className="mt-4 text-body text-[#98584b]">{error}</p>}
            <label className="mt-5 flex items-center justify-between border-y border-[#e8e7e2] py-4">
              <span className="text-body font-medium text-[#55554f]">当前模型</span>
              <select
                aria-busy={saving}
                value={preference?.modelConfigId ?? ""}
                disabled={loading || saving || configs.length === 0}
                onChange={(event) => void updatePreference(event.target.value)}
                className="h-9 w-[340px] rounded-[6px] border border-[#d8d7d1] bg-white px-3 text-body outline-none disabled:bg-[#efefeb]"
              >
                <option value="">使用自己的默认模型</option>
                {configs.map((config) => (
                  <option key={config.id} value={config.id}>{modelLabel(config)}{config.isDefault ? "（默认）" : ""}</option>
                ))}
              </select>
            </label>
            {!loading && configs.length === 0 && <p className="mt-3 text-body text-[#9a655c]">请先在模型设置中添加可用模型。</p>}
          </div>
        )}

        {tab === "skills" && <AgentSkillManager agent={agent} projects={projects} />}

        {tab === "tools" && <AgentToolManager agent={agent} />}

        {tab === "knowledge" && <AgentKnowledgeManager agent={agent} />}

        {tab === "test" && <AgentTestPanel agent={agent} projects={projects} />}
      </div>

      {notice && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#243f34] px-4 py-2.5 text-body font-medium text-white shadow-lg">✓ {notice}</div>}
    </div>
  );
}
