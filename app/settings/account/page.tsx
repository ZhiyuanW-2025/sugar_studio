import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountSettings } from "../../../components/AccountSettings";
import { createClient } from "../../../lib/supabase/server";

export const dynamic="force-dynamic";
export default async function AccountSettingsPage(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/");return <main className="min-h-screen bg-[#f7f7f4] text-[#1f1f1c]"><header className="flex h-14 items-center border-b border-[#e5e4df] bg-[#fafaf8] px-6"><Link href="/" className="text-body font-medium text-[#4d4c46]">← 返回工作台</Link><nav className="ml-auto flex gap-4 text-body"><Link href="/settings/account" className="font-medium text-[#29463a]">账户</Link><Link href="/settings/models" className="text-[#88877f]">模型设置</Link><Link href="/settings/agents" className="text-[#88877f]">Agent 管理</Link></nav></header><AccountSettings/></main>}
