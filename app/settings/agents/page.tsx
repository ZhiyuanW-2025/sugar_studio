import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentManagementHome } from "../../../components/agent-management/AgentManagementHome";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AgentManagementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#1f1f1c]">
      <header className="flex h-14 items-center border-b border-[#e5e4df] bg-[#fafaf8] px-6">
        <Link href="/" className="flex items-center gap-2.5 text-body font-medium text-[#4d4c46] hover:text-[#20201d]">← 返回工作台</Link>
        <span className="ml-auto text-body text-[#999890]">Agent 管理</span>
      </header>
      <AgentManagementHome />
    </main>
  );
}
