import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerConfig } from "./config";

/**
 * Create an isolated elevated client. It must never share a user's session or
 * be imported by a Client Component.
 */
export function createAdminClient() {
  const { url, secretKey } = getSupabaseServerConfig();

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
