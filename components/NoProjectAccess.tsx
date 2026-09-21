"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";

type NoProjectAccessProps = {
  displayName: string;
  email: string;
};

export function NoProjectAccess({ displayName, email }: NoProjectAccessProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    const { error: signOutError } = await createClient().auth.signOut({ scope: "local" });
    if (signOutError) {
      setError("退出失败，请稍后重试。");
      setIsSigningOut(false);
      return;
    }
    router.refresh();
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName.trim(), description: "" }),
      });
      const payload = await response.json().catch(() => null) as { project?: unknown; error?: string } | null;
      if (!response.ok || !payload?.project) throw new Error(payload?.error || "项目创建失败，请稍后重试。");
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "项目创建失败，请稍后重试。");
      setCreating(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4] px-6">
      <section className="w-full max-w-[430px] border-t border-[#deddd7] pt-7">
        <p className="text-body font-medium uppercase tracking-[0.13em] text-[#999890]">Sugar Agent</p>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.035em] text-[#20201d]">尚未加入项目</h1>
        <p className="mt-3 text-body leading-6 text-[#6f6e67]">
          {displayName}（{email}）已登录，但还不是任何项目的成员。你可以创建第一个项目，或请现有项目成员通过邮箱将你加入。
        </p>
        <form onSubmit={createProject} className="mt-6 flex gap-2">
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} placeholder="新项目名称" className="h-9 min-w-0 flex-1 rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" />
          <button type="submit" aria-busy={creating} disabled={creating || !projectName.trim()} className="h-9 rounded-[7px] bg-[#243f34] px-3.5 text-body font-medium text-white disabled:opacity-40">{creating ? "创建中…" : "创建项目"}</button>
        </form>
        {error && <p role="alert" className="mt-3 text-body text-[#895c49]">{error}</p>}
        <button type="button" aria-busy={isSigningOut} onClick={handleSignOut} disabled={isSigningOut} className="mt-5 text-body text-[#77766f] underline underline-offset-2 disabled:opacity-60">{isSigningOut ? "正在退出…" : "退出登录"}</button>
      </section>
    </main>
  );
}
