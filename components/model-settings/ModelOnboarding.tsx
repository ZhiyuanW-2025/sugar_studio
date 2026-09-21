"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { providerOptions } from "../../lib/model-config/catalog";

type Props = {
  displayName: string;
  hasModelConfig: boolean;
};

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function ModelOnboarding({ displayName, hasModelConfig }: Props) {
  const router = useRouter();
  const provider = providerOptions[0];
  const [model, setModel] = useState<string>(provider.models[0].value);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(hasModelConfig);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string>();
  const selectedModel = useMemo(
    () => provider.models.find((item) => item.value === model)?.label ?? model,
    [model, provider.models],
  );

  const finish = async () => {
    const response = await fetch("/api/onboarding/model", { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "暂时无法进入工作台。");
    router.replace("/");
    router.refresh();
  };

  const save = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busy) return;
    setBusy("save");
    setError(undefined);
    try {
      if (!configured) {
        const response = await fetch("/api/model-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: provider.value, model, apiKey, isDefault: true }),
        });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "模型配置保存失败。");
        setConfigured(true);
        setApiKey("");
      }
      await finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型配置保存失败。");
      setBusy(null);
    }
  };

  const skip = async () => {
    if (busy) return;
    setBusy("skip");
    setError(undefined);
    try {
      await finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法进入工作台。");
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#eeeee9] p-3 text-[#20221e] sm:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-40px)] max-w-[1440px] overflow-hidden rounded-[18px] border border-black/[0.06] bg-[#f8f6f0] shadow-[0_24px_80px_rgba(32,42,36,0.10)] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative overflow-hidden bg-[#173d32] px-7 py-8 text-[#f5f2e9] sm:px-12 sm:py-11 lg:px-16">
          <div className="absolute -right-24 top-20 h-80 w-80 rounded-full border border-white/[0.08]" aria-hidden="true" />
          <div className="absolute -right-8 top-44 h-56 w-56 rounded-full border border-white/[0.08]" aria-hidden="true" />
          <div className="relative flex h-full flex-col">
            <header className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-white/20 bg-white/10 text-body font-semibold">S</span>
              <div><p className="text-body font-semibold">Sugar Agent</p><p className="text-micro uppercase tracking-[0.2em] text-[#9fb9ae]">First setup</p></div>
            </header>

            <div className="my-auto py-12">
              <p className="text-control font-medium uppercase tracking-[0.16em] text-[#a8c0b6]">欢迎加入，{displayName}</p>
              <h1 className="mt-4 max-w-[520px] text-[clamp(34px,4vw,54px)] font-medium leading-[1.12] tracking-[-0.045em]">先为你的 Agent<br />准备一个模型</h1>
              <p className="mt-5 max-w-[480px] text-body leading-7 text-[#b8cec5]">模型配置只属于你。完成后，小花、牛牛、小熊、小雪和拉夫会默认使用这份配置；以后可以随时在模型设置中调整。</p>

              <ol className="mt-9 space-y-5">
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-control text-[#e9d0b5]">1</span><div><p className="text-body font-medium">登录 OpenAI API Platform</p><a href="https://platform.openai.com/" target="_blank" rel="noreferrer" className="mt-1 inline-block text-control text-[#a8c9ba] underline decoration-white/20 underline-offset-4">打开 platform.openai.com ↗</a></div></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-control text-[#e9d0b5]">2</span><div><p className="text-body font-medium">创建一把 API Key</p><p className="mt-1 text-control leading-5 text-[#9fb9ae]">进入 API Keys，点击 Create new secret key，选择项目并创建。</p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-control text-[#a8c9ba] underline decoration-white/20 underline-offset-4">前往 API Keys ↗</a></div></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-control text-[#e9d0b5]">3</span><div><p className="text-body font-medium">确认 API 账户可用</p><p className="mt-1 text-control leading-5 text-[#9fb9ae]">API 与 ChatGPT 订阅分开计费；如尚未开通 API 额度，请先在 Platform 配置支付方式和预算提醒。</p><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-control text-[#a8c9ba] underline decoration-white/20 underline-offset-4">查看 API Billing ↗</a></div></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-control text-[#e9d0b5]">4</span><div><p className="text-body font-medium">粘贴到右侧并保存</p><p className="mt-1 text-control leading-5 text-[#9fb9ae]">Sugar Agent 只在服务端处理密钥，并加密保存到 Supabase Vault；完整密钥不会返回浏览器。</p></div></li>
              </ol>
            </div>

            <a href="https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety" target="_blank" rel="noreferrer" className="text-control text-[#8fa99f] hover:text-white">OpenAI API Key 安全建议 ↗</a>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-12 sm:px-12 lg:px-20">
          <div className="w-full max-w-[520px]">
            <div className="flex items-center justify-between"><p className="text-control font-medium uppercase tracking-[0.16em] text-[#929087]">首次设置</p><span className="rounded-full border border-[#dedbd1] px-2.5 py-1 text-micro text-[#88867e]">可稍后完成</span></div>
            <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.04em]">连接你的 OpenAI 模型</h2>
            <p className="mt-2 text-body leading-6 text-[#74736c]">这份 API Key 仅供你自己的 Agent 调用使用，不会与其他成员共享。</p>

            {configured ? (
              <div className="mt-8 rounded-[10px] border border-[#cbd9d1] bg-[#edf4ef] px-4 py-4"><p className="text-body font-semibold text-[#315c4a]">✓ 已检测到可用模型配置</p><p className="mt-1 text-control text-[#61766c]">可以直接进入工作台，之后仍可在“模型设置”中管理。</p></div>
            ) : (
              <form id="model-onboarding-form" onSubmit={save} className="mt-8 space-y-5">
                <label className="block"><span className="mb-2 block text-body font-medium text-[#55554f]">提供商</span><div className="flex h-11 items-center rounded-[8px] border border-[#d9d7cf] bg-[#efeee9] px-3 text-body font-medium text-[#55554f]">OpenAI <span className="ml-auto text-control font-normal text-[#99978f]">当前支持</span></div></label>
                <label className="block"><span className="mb-2 block text-body font-medium text-[#55554f]">默认模型</span><select value={model} onChange={(event) => setModel(event.target.value)} disabled={Boolean(busy)} className="h-11 w-full rounded-[8px] border border-[#d9d7cf] bg-white px-3 text-body outline-none focus:border-[#80998d]">{provider.models.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className="mt-1.5 block text-control text-[#99978f]">所有 Agent 默认使用 {selectedModel}，后续可以单独指定。</span></label>
                <label className="block"><span className="mb-2 block text-body font-medium text-[#55554f]">OpenAI API Key</span><input type="password" autoComplete="off" required minLength={8} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={Boolean(busy)} placeholder="sk-…" className="h-11 w-full rounded-[8px] border border-[#d9d7cf] bg-white px-3 font-mono text-body outline-none focus:border-[#80998d]" /><span className="mt-1.5 block text-control text-[#99978f]">保存后仅显示末尾几位，完整密钥不会再次展示。</span></label>
              </form>
            )}

            {error && <p role="alert" className="mt-5 rounded-[8px] border border-[#ead7cf] bg-[#fbf2ee] px-3.5 py-3 text-body text-[#8a5042]">{error}</p>}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
              <button type="button" onClick={() => void skip()} disabled={Boolean(busy)} className="h-11 px-3 text-body font-medium text-[#77756e] hover:text-[#30312d] disabled:opacity-45">{busy === "skip" ? "正在进入…" : "暂时跳过，稍后设置"}</button>
              {configured ? <button type="button" onClick={() => void save()} disabled={Boolean(busy)} className="h-11 rounded-[8px] bg-[#173d32] px-5 text-body font-medium text-white hover:bg-[#123228] disabled:opacity-45 sm:ml-auto">{busy === "save" ? "正在进入…" : "进入工作台"}</button> : <button type="submit" form="model-onboarding-form" disabled={Boolean(busy) || apiKey.length < 8} className="h-11 rounded-[8px] bg-[#173d32] px-5 text-body font-medium text-white hover:bg-[#123228] disabled:opacity-35 sm:ml-auto">{busy === "save" ? "正在安全保存…" : "保存并进入工作台"}</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
