import "server-only";

import { createAdminClient } from "../supabase/admin";

export async function recordSecurityEvent(userId: string, eventType: string, summary: string, metadata: Record<string, string> = {}) {
  await createAdminClient().from("account_security_events").insert({ user_id: userId, event_type: eventType, summary, metadata });
}
