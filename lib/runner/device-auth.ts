import "server-only";

import { createAdminClient } from "../supabase/admin";
import { bearerToken, sha256 } from "./security";

export type RunnerDevice = {
  id: string;
  user_id: string;
  name: string;
  platform: string | null;
  app_version: string | null;
  status: "active" | "revoked";
  last_seen_at: string | null;
};

export async function authenticateRunnerDevice(request: Request): Promise<RunnerDevice | null> {
  const token = bearerToken(request);
  if (!token || token.length < 32) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("runner_devices")
    .select("id,user_id,name,platform,app_version,status,last_seen_at")
    .eq("token_hash", await sha256(token))
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  if (!data.last_seen_at || Date.now() - new Date(data.last_seen_at).getTime() > 30_000) {
    await admin.from("runner_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return data as RunnerDevice;
}
