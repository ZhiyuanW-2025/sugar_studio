"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";

type Mode = "login" | "register";
type BusyAction = "auth" | "reset" | null;

const agents = [
  { mark: "花", name: "制作人小花", detail: "统筹项目与知识" },
  { mark: "牛", name: "工程师牛牛", detail: "连接代码与执行" },
  { mark: "熊", name: "艺术家小熊", detail: "视觉创意与制作" },
  { mark: "雪", name: "客户伙伴小雪", detail: "材料与客户沟通" },
  { mark: "拉", name: "金牌买手拉夫", detail: "采购找品与询价" },
  { mark: "豆", name: "宣传委员豆豆", detail: "营销图文与传播" },
];

function EyeIcon({ open }: { open: boolean }) {
  return open ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.5"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M10.6 7.1A9.6 9.6 0 0 1 12 7c5.6 0 9 5 9 5a15 15 0 0 1-2.1 2.5M15.7 16.3A9 9 0 0 1 12 17c-5.6 0-9-5-9-5a15 15 0 0 1 3.1-3.4"/></svg>;
}

export function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [resetSent, setResetSent] = useState(false);
  const [registrationSent, setRegistrationSent] = useState(false);

  const passwordScore = useMemo(() => {
    if (!password) return 0;
    return [password.length >= 10, /[A-Za-z]/.test(password) && /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  }, [password]);

  const changeMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setResetSent(false);
    setRegistrationSent(false);
    setPassword("");
    setConfirmation("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResetSent(false);
    setRegistrationSent(false);

    if (mode === "register") {
      if (displayName.trim().length < 2) return setError("请填写至少 2 个字的姓名或工作称呼。");
      if (password.length < 10) return setError("密码至少需要 10 位。");
      if (password !== confirmation) return setError("两次输入的密码不一致。");
    }

    setBusy("auth");
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        router.refresh();
        return;
      }
      setRegistrationSent(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : "";
      if (mode === "register" && (message.includes("already") || message.includes("registered"))) {
        setError("这个邮箱已经注册，可以直接登录或重置密码。");
      } else {
        setError(mode === "login" ? "邮箱或密码不正确，请检查后重试。" : "暂时无法创建账号，请稍后再试。");
      }
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) { setError("请先填写邮箱，再发送重置邮件。"); return; }
    setBusy("reset"); setError(null); setResetSent(false);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!response.ok) throw new Error("reset failed");
      setResetSent(true);
    } catch {
      setError("暂时无法发送重置邮件，请稍后重试。");
    } finally {
      setBusy(null);
    }
  };

  return <main className="auth-stage min-h-screen overflow-hidden bg-[#f4f1ea] text-[#20221e]">
    <div className="auth-shell mx-auto grid min-h-screen max-w-[1680px] grid-cols-[minmax(560px,1.12fr)_minmax(460px,.88fr)] p-3">
      <section className="auth-story relative flex min-h-[calc(100vh-24px)] overflow-hidden rounded-[18px] bg-[#173d32] px-[clamp(44px,5.4vw,88px)] py-[clamp(38px,5.5vh,72px)] text-[#f6f3eb]">
        <div className="auth-grain" aria-hidden="true" />
        <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
        <div className="auth-orbit auth-orbit-two" aria-hidden="true" />
        <div className="relative z-10 flex w-full flex-col">
          <header className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[11px] border border-white/20 bg-white/10 text-[15px] font-semibold tracking-[-0.03em]">S</div>
            <div><p className="text-[15px] font-semibold tracking-[-0.02em]">Sugar Agent</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-[#a8c0b6]">Studio Operating System</p></div>
          </header>

          <div className="my-auto max-w-[660px] py-14">
            <div className="mb-7 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em] text-[#bed0c8]"><span className="h-px w-8 bg-[#c68058]" />Built for creative studios</div>
            <h1 className="max-w-[620px] text-[clamp(44px,4.4vw,72px)] font-medium leading-[1.08] tracking-[-0.055em]">薯格工作室<br/><span className="text-[#e4c8a9]">AI Agent团队</span></h1>
            <p className="mt-7 max-w-[530px] text-[16px] leading-8 text-[#bad0c7]">把脏活累活苦活交给我们干，聪明的你们负责动脑就好</p>

            <div className="auth-agent-flow mt-10 grid max-w-[620px] grid-cols-2 gap-2.5">
              {agents.map((agent, index) => <div key={agent.name} className="auth-agent-card group flex min-w-0 items-center gap-2.5 rounded-[11px] border border-white/10 bg-white/[0.055] px-3 py-2.5 backdrop-blur-sm" style={{ animationDelay: `${index * 90}ms` }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f0e7d8] text-[12px] font-semibold text-[#28483e]">{agent.mark}</span><span><strong className="block text-[13px] font-medium text-[#f1f0e9]">{agent.name}</strong><small className="mt-0.5 block text-[11px] text-[#93aea3]">{agent.detail}</small></span><span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#82b59c] shadow-[0_0_0_4px_rgba(130,181,156,.08)]" />
              </div>)}
            </div>
          </div>

          <footer className="flex items-end justify-between border-t border-white/10 pt-5 text-[11px] text-[#8ea89e]"><p>SHUGE CULTURE · INTERNAL WORKSPACE</p><p className="text-right leading-5">Projects stay in context.<br/>People stay in control.</p></footer>
        </div>
      </section>

      <section className="relative grid min-h-[calc(100vh-24px)] place-items-center px-[clamp(50px,6.5vw,104px)] py-14">
        <div className="auth-form-enter w-full max-w-[430px]">
          <div className="mb-10 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8c8a80]">Welcome to Sugar</p><p className="mt-2 text-[13px] text-[#949187]">工作室成员专属空间</p></div><span className="rounded-full border border-[#d9d5ca] px-3 py-1.5 text-[11px] text-[#757268]">Private Beta</span></div>

          <div className="relative grid h-11 grid-cols-2 rounded-[11px] bg-[#e8e4db] p-1" role="tablist" aria-label="登录或注册">
            <span aria-hidden="true" className={`auth-tab-indicator absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-[8px] bg-[#faf8f3] shadow-[0_2px_9px_rgba(43,45,39,.08)] ${mode === "register" ? "translate-x-full" : "translate-x-0"}`} />
            <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => changeMode("login")} className={`relative z-10 rounded-[8px] text-[13px] font-medium transition-colors ${mode === "login" ? "text-[#26352f]" : "text-[#8b887f]"}`}>登录</button>
            <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => changeMode("register")} className={`relative z-10 rounded-[8px] text-[13px] font-medium transition-colors ${mode === "register" ? "text-[#26352f]" : "text-[#8b887f]"}`}>创建账号</button>
          </div>

          <div className="mt-9">
            <h2 className="text-[30px] font-semibold tracking-[-0.045em] text-[#20231f]">{mode === "login" ? "欢迎回来" : "加入工作室"}</h2>
            <p className="mt-2 text-[14px] leading-6 text-[#858278]">{mode === "login" ? "继续推进正在发生的项目。" : "创建账号后，由项目负责人把你加入对应项目。"}</p>
          </div>

          {registrationSent ? <div className="mt-8 rounded-[12px] border border-[#cbd8cf] bg-[#edf4ef] p-5"><div className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-[#315d4c] text-white">✓</div><h3 className="text-[16px] font-semibold text-[#29483c]">检查你的邮箱</h3><p className="mt-2 text-[13px] leading-6 text-[#60766c]">确认邮件已经发送至 <strong className="font-medium text-[#344c42]">{email}</strong>。完成验证后即可登录。</p><button type="button" onClick={() => changeMode("login")} className="mt-4 text-[13px] font-medium text-[#315d4c] underline decoration-[#9eb4a8] underline-offset-4">返回登录</button></div> : <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
            {mode === "register" && <label className="auth-field block"><span>姓名或工作称呼</span><input type="text" autoComplete="name" required minLength={2} maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="我们应该如何称呼你？" /></label>}
            <label className="auth-field block"><span>工作邮箱</span><input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@studio.com" /></label>
            <div className="auth-field block"><span className="flex items-center justify-between"><label htmlFor="auth-password">密码</label>{mode === "login" && <button type="button" disabled={busy !== null} onClick={() => void resetPassword()} className="text-[11px] font-normal text-[#557568] transition hover:text-[#294e40]">忘记密码？</button>}</span><span className="relative block"><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 6 : 10} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "输入密码" : "至少 10 位"} className="pr-11"/><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)} className="auth-eye absolute right-3 top-1/2 -translate-y-1/2 text-[#8e8b82]"><EyeIcon open={showPassword}/></button></span></div>
            {mode === "register" && <><label className="auth-field block"><span>确认密码</span><input type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入密码" /></label><div className="flex items-center gap-2 px-0.5"><span className={`h-1 flex-1 rounded-full ${passwordScore >= 1 ? "bg-[#8aab9b]" : "bg-[#ddd9cf]"}`} /><span className={`h-1 flex-1 rounded-full ${passwordScore >= 2 ? "bg-[#638d79]" : "bg-[#ddd9cf]"}`} /><span className={`h-1 flex-1 rounded-full ${passwordScore >= 3 ? "bg-[#315d4c]" : "bg-[#ddd9cf]"}`} /><small className="ml-1 w-14 text-right text-[10px] text-[#98958b]">{password ? ["", "可用", "良好", "很强"][passwordScore] : "密码强度"}</small></div></>}

            {error && <p role="alert" className="auth-message auth-message-error">{error}</p>}
            {resetSent && <p role="status" className="auth-message auth-message-success">如果该邮箱存在，重置邮件已经发送。</p>}

            <button type="submit" disabled={busy !== null} aria-busy={busy === "auth"} className="auth-primary-button group flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#1d4437] text-[13px] font-medium text-white shadow-[0_10px_28px_rgba(29,68,55,.16)] transition hover:bg-[#163a2f] disabled:cursor-wait disabled:opacity-60"><span>{busy === "auth" ? mode === "login" ? "正在进入工作台…" : "正在创建账号…" : mode === "login" ? "进入工作台" : "创建账号"}</span>{busy !== "auth" && <span className="transition-transform duration-200 group-hover:translate-x-0.5">↗</span>}</button>
          </form>}

          <p className="mt-7 text-center text-[11px] leading-5 text-[#9b988e]">登录即表示你同意遵守工作室的数据与安全规范。<br/>Sugar Agent 不会擅自执行需要确认的外部操作。</p>
        </div>
      </section>
    </div>
  </main>;
}
