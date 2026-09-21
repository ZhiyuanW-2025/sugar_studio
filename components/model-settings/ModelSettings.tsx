"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  imageModelOptions,
  type ImageModel,
} from "../../lib/image-generation/catalog";
import type { ImageModelPreference } from "../../lib/image-generation/types";
import {
  agentOptions,
  providerOptions,
  type AgentModelPreference,
  type ModelAgentType,
  type ModelConfigSummary,
  type ModelProvider,
} from "../../lib/model-config/catalog";

type SettingsPayload = {
  configs: ModelConfigSummary[];
  preferences: AgentModelPreference[];
  imagePreference: ImageModelPreference | null;
};

type EditState = {
  id: string;
  provider: ModelProvider;
  model: string;
  apiKey: string;
  makeDefault: boolean;
};

const providerName = (provider: ModelProvider) =>
  providerOptions.find((option) => option.value === provider)?.label ?? provider;

const modelName = (provider: ModelProvider, model: string) =>
  providerOptions
    .find((option) => option.value === provider)
    ?.models.find((option) => option.value === model)?.label ?? model;

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function ModelSettings() {
  const firstProvider = providerOptions[0];
  const [configs, setConfigs] = useState<ModelConfigSummary[]>([]);
  const [preferences, setPreferences] = useState<AgentModelPreference[]>([]);
  const [imageModel, setImageModel] = useState<ImageModel>(imageModelOptions[0].value);
  const [imageCredentialId, setImageCredentialId] = useState("");
  const [provider, setProvider] = useState<ModelProvider>(firstProvider.value);
  const [model, setModel] = useState<string>(firstProvider.models[0].value);
  const [apiKey, setApiKey] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/model-settings", { cache: "no-store" });
    const payload = await readJson(response);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "读取模型设置失败。");
      setLoading(false);
      return;
    }
    const data = payload as unknown as SettingsPayload;
    setConfigs(data.configs);
    setPreferences(data.preferences);
    setImageModel(data.imagePreference?.model ?? imageModelOptions[0].value);
    setImageCredentialId(
      data.imagePreference?.credentialConfigId
      ?? data.configs.find((config) => config.provider === "openai" && config.isDefault)?.id
      ?? data.configs.find((config) => config.provider === "openai")?.id
      ?? "",
    );
    setMakeDefault(data.configs.length === 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Loading remote settings is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings();
  }, [loadSettings]);

  const currentProvider = useMemo(
    () => providerOptions.find((option) => option.value === provider) ?? firstProvider,
    [firstProvider, provider],
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/model-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey, isDefault: makeDefault }),
    });
    const payload = await readJson(response);
    setApiKey("");
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "保存模型失败。");
      return;
    }
    showNotice("模型配置已保存");
    await loadSettings();
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!edit) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/model-settings/${edit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: edit.provider,
        model: edit.model,
        apiKey: edit.apiKey || undefined,
        isDefault: edit.makeDefault || undefined,
      }),
    });
    const payload = await readJson(response);
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "更新模型失败。");
      return;
    }
    setEdit(null);
    showNotice("模型配置已更新");
    await loadSettings();
  };

  const handleDefault = async (configId: string) => {
    setSaving(true);
    const response = await fetch(`/api/model-settings/${configId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    const payload = await readJson(response);
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "设置默认模型失败。");
      return;
    }
    showNotice("默认模型已更新");
    await loadSettings();
  };

  const handleDelete = async (config: ModelConfigSummary) => {
    if (!window.confirm(`删除 ${modelName(config.provider, config.model)}？相关 Agent 将回退到默认模型。`)) return;
    setSaving(true);
    const response = await fetch(`/api/model-settings/${config.id}`, { method: "DELETE" });
    const payload = await readJson(response);
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "删除模型失败。");
      return;
    }
    showNotice("模型配置已删除");
    await loadSettings();
  };

  const handlePreference = async (agentType: ModelAgentType, modelConfigId: string) => {
    setSaving(true);
    const response = await fetch("/api/model-settings/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType, modelConfigId: modelConfigId || null }),
    });
    const payload = await readJson(response);
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "更新 Agent 偏好失败。");
      return;
    }
    setPreferences((current) => [
      ...current.filter((item) => item.agentType !== agentType),
      ...(modelConfigId ? [{ agentType, modelConfigId }] : []),
    ]);
    showNotice("Agent 模型偏好已更新");
  };

  const handleImagePreference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!imageCredentialId) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/model-settings/image-preference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: imageModel, credentialConfigId: imageCredentialId }),
    });
    const payload = await readJson(response);
    setSaving(false);
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "保存图片模型设置失败。");
      return;
    }
    showNotice("小熊图片模型已更新");
  };

  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-10">
      <div className="mb-9">
        <p className="text-body font-medium uppercase tracking-[0.14em] text-[#999890]">个人设置</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.04em]">模型设置</h1>
        <p className="mt-2 max-w-[620px] text-body leading-6 text-[#73736d]">
          管理你自己的模型凭证和 Agent 偏好。API Key 加密保存在 Supabase Vault，不会显示完整内容。
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-[7px] border border-[#ead5ce] bg-[#fbf2ef] px-4 py-3 text-body text-[#8e493d]">
          {error}
        </div>
      )}

      <section className="border-t border-[#deddd7] py-7">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-section-title font-semibold">已配置模型</h2>
            <p className="mt-1 text-body text-[#898880]">每个模型保留独立凭证。</p>
          </div>
          {!loading && <span className="text-body text-[#aaa9a1]">{configs.length} 个配置</span>}
        </div>

        {loading ? (
          <p role="status" className="py-7 text-body text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#557267]" />正在读取模型设置…</p>
        ) : configs.length === 0 ? (
          <div className="border-l-2 border-[#cbd8d1] py-2 pl-4">
            <p className="text-body font-medium text-[#45453f]">尚未配置可用模型</p>
            <p className="mt-1 text-body text-[#898880]">请先在下方添加模型；第一个配置会自动成为默认模型。</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">
            {configs.map((config) => (
              <div key={config.id} className="py-4">
                {edit?.id === config.id ? (
                  <form onSubmit={handleUpdate} className="grid grid-cols-[150px_1fr_1fr_auto] items-end gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-control font-medium text-[#88877f]">提供商</span>
                      <select
                        value={edit.provider}
                        onChange={(event) => setEdit({ ...edit, provider: event.target.value as ModelProvider })}
                        className="h-9 w-full rounded-[6px] border border-[#d8d7d1] bg-white px-2.5 text-body outline-none"
                      >
                        {providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-control font-medium text-[#88877f]">模型</span>
                      <input value={edit.model} onChange={(event) => setEdit({ ...edit, model: event.target.value })} className="h-9 w-full rounded-[6px] border border-[#d8d7d1] bg-white px-2.5 text-body outline-none" />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-control font-medium text-[#88877f]">新 API Key（可留空）</span>
                      <input type="password" autoComplete="off" value={edit.apiKey} onChange={(event) => setEdit({ ...edit, apiKey: event.target.value })} className="h-9 w-full rounded-[6px] border border-[#d8d7d1] bg-white px-2.5 text-body outline-none" placeholder={config.apiKeyMasked} />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEdit(null)} className="h-9 px-2 text-body text-[#77766f]">取消</button>
                      <button type="submit" aria-busy={saving} disabled={saving} className="h-9 rounded-[6px] bg-[#243f34] px-3 text-body font-medium text-white disabled:opacity-60">{saving ? "保存中…" : "保存"}</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="grid h-9 w-9 place-items-center rounded-[7px] bg-[#eeeeea] text-body font-semibold text-[#55554f]">AI</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-body font-medium">{providerName(config.provider)} · {modelName(config.provider, config.model)}</p>
                        {config.isDefault && <span className="rounded-full bg-[#e9f2ed] px-2 py-0.5 text-caption font-medium text-[#356451]">默认模型</span>}
                      </div>
                      <p className="mt-1 font-mono text-body text-[#999890]">API Key：{config.apiKeyMasked}</p>
                    </div>
                    {!config.isDefault && <button type="button" aria-busy={saving} disabled={saving} onClick={() => void handleDefault(config.id)} className="text-body text-[#587165] hover:text-[#243f34]">{saving ? "处理中…" : "设为默认"}</button>}
                    <button type="button" onClick={() => setEdit({ id: config.id, provider: config.provider, model: config.model, apiKey: "", makeDefault: false })} className="text-body text-[#77766f] hover:text-[#33332f]">更新</button>
                    <button type="button" aria-busy={saving} disabled={saving} onClick={() => void handleDelete(config)} className="text-body text-[#9a655c] hover:text-[#7e4036]">{saving ? "处理中…" : "删除"}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-[#deddd7] py-7">
        <h2 className="text-section-title font-semibold">添加模型</h2>
        <form onSubmit={handleCreate} className="mt-5 grid grid-cols-[160px_1fr_1fr] gap-4">
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-[#66665f]">提供商</span>
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as ModelProvider;
                const nextProvider = providerOptions.find((option) => option.value === next) ?? firstProvider;
                setProvider(next);
                setModel(nextProvider.models[0].value);
              }}
              className="h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]"
            >
              {providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-[#66665f]">模型</span>
            <input list="model-options" required value={model} onChange={(event) => setModel(event.target.value)} className="h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" />
            <datalist id="model-options">{currentProvider.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-[#66665f]">API Key</span>
            <input type="password" autoComplete="off" required minLength={8} value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" placeholder="sk-…" />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-body text-[#66665f]">
            <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} className="accent-[#28604f]" />
            设为默认模型
          </label>
          <button type="submit" aria-busy={saving} disabled={saving} className="h-9 justify-self-end rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white hover:bg-[#1d342b] disabled:opacity-60">
            {saving ? "正在保存…" : "添加模型"}
          </button>
        </form>
      </section>

      <section className="border-t border-[#deddd7] py-7">
        <h2 className="text-section-title font-semibold">Agent 模型偏好</h2>
        <p className="mt-1 text-body text-[#898880]">未单独指定时使用你的默认模型。</p>
        <div className="mt-5 divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">
          {agentOptions.map((agent) => {
            const preference = preferences.find((item) => item.agentType === agent.value);
            return (
              <label key={agent.value} className="flex items-center justify-between py-4">
                <span className="text-body font-medium text-[#4d4c46]">{agent.label}</span>
                <select
                  aria-busy={saving}
                  value={preference?.modelConfigId ?? ""}
                  disabled={saving || configs.length === 0}
                  onChange={(event) => void handlePreference(agent.value, event.target.value)}
                  className="h-9 w-[310px] rounded-[6px] border border-[#d8d7d1] bg-white px-3 text-body text-[#55554f] outline-none disabled:bg-[#efefeb] disabled:text-[#aaa9a1]"
                >
                  <option value="">使用默认模型</option>
                  {configs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {providerName(config.provider)} · {modelName(config.provider, config.model)}{config.isDefault ? "（默认）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>

      <section className="border-t border-[#deddd7] py-7">
        <h2 className="text-section-title font-semibold">小熊图片生成模型</h2>
        <p className="mt-1 max-w-[660px] text-body leading-5 text-[#898880]">
          图片模型复用你已有的 OpenAI 凭证，API Key 不会再次发送到浏览器。未单独保存时，默认使用 GPT Image 2.5 Flare 和默认 OpenAI 凭证。
        </p>
        <form onSubmit={handleImagePreference} className="mt-5 grid grid-cols-[1fr_1fr_auto] items-end gap-4">
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-[#66665f]">图片模型</span>
            <select
              value={imageModel}
              onChange={(event) => setImageModel(event.target.value as ImageModel)}
              className="h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]"
            >
              {imageModelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className="mt-1.5 block text-control text-[#aaa9a1]">
              {imageModelOptions.find((option) => option.value === imageModel)?.description}
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-[#66665f]">使用凭证</span>
            <select
              value={imageCredentialId}
              onChange={(event) => setImageCredentialId(event.target.value)}
              disabled={configs.length === 0}
              className="h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93] disabled:bg-[#efefeb] disabled:text-[#aaa9a1]"
            >
              {configs.length === 0 && <option value="">请先添加 OpenAI 凭证</option>}
              {configs.filter((config) => config.provider === "openai").map((config) => (
                <option key={config.id} value={config.id}>
                  OpenAI · {modelName(config.provider, config.model)} · {config.apiKeyMasked}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-busy={saving}
            disabled={saving || !imageCredentialId}
            className="h-10 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white hover:bg-[#1d342b] disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存图片设置"}
          </button>
        </form>
      </section>

      {notice && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#243f34] px-4 py-2.5 text-body font-medium text-white shadow-lg">✓ {notice}</div>}
    </div>
  );
}
