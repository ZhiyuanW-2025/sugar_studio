import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./config";

/** Create a request-scoped Supabase client for server-side application code. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. This becomes relevant only
          // if cookie-based Auth is added in a later phase.
        }
      },
    },
  });
}

/**
 * Verify that the server can reach the project's Supabase services.
 * This calls a read-only health endpoint and does not create a session or data.
 */
export async function checkSupabaseConnection() {
  const { url, publishableKey } = getSupabasePublicConfig();
  const response = await fetch(`${url}/auth/v1/health`, {
    method: "GET",
    headers: {
      apikey: publishableKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase connection failed with status ${response.status}.`);
  }

  return {
    ok: true as const,
    service: "supabase" as const,
    status: response.status,
  };
}
