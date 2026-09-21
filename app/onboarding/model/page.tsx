import { redirect } from "next/navigation";
import { ModelOnboarding } from "../../../components/model-settings/ModelOnboarding";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ModelOnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [{ data: profile }, { count: modelConfigCount }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, model_onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_model_configs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  if (profile?.model_onboarding_completed_at) redirect("/");

  return (
    <ModelOnboarding
      displayName={profile?.display_name || user.email?.split("@")[0] || "新成员"}
      hasModelConfig={(modelConfigCount ?? 0) > 0}
    />
  );
}
