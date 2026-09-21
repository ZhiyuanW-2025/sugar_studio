import Link from "next/link";
import { redirect } from "next/navigation";
import { ModelSettings } from "../../../components/model-settings/ModelSettings";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ModelSettingsRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const displayName = profile?.display_name || user.email?.split("@")[0] || "Sugar User";

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#1f1f1c]">
      <header className="flex h-14 items-center border-b border-[#e5e4df] bg-[#fafaf8] px-6">
        <Link href="/" className="flex items-center gap-2.5 text-body font-medium text-[#4d4c46] hover:text-[#20201d]">
          <span aria-hidden="true">←</span>
          返回工作台
        </Link>
        <div className="ml-auto text-body text-[#88877f]">{displayName}</div>
      </header>
      <ModelSettings />
    </main>
  );
}
