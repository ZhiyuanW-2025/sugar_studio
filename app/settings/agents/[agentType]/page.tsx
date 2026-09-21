import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentManagementDetail } from "../../../../components/agent-management/AgentManagementDetail";
import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AgentManagementDetailPage({
  params,
}: {
  params: Promise<{ agentType: string }> | { agentType: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { agentType } = await params;
  const agent = getAgentDefinition(agentType);
  if (!agent) notFound();
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, name")
    .order("name");
  const projects = (projectRows ?? []).map((project) => ({ id: project.id, name: project.name }));

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#1f1f1c]">
      <header className="flex h-14 items-center border-b border-[#e5e4df] bg-[#fafaf8] px-6">
        <Link href="/settings/agents" className="flex items-center gap-2.5 text-body font-medium text-[#4d4c46] hover:text-[#20201d]">← Agent 管理</Link>
        <span className="ml-auto text-body text-[#999890]">{agent.name}</span>
      </header>
      <AgentManagementDetail agent={agent} projects={projects} />
    </main>
  );
}
