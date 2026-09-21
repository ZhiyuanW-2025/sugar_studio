export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseServerConfig = SupabasePublicConfig & {
  secretKey: string;
};

/**
 * Read and validate the public Supabase connection settings.
 *
 * The publishable key is intentionally safe for browser use. Never place a
 * service-role or secret key in a NEXT_PUBLIC_* variable.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use http or https.");
  }

  return {
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey,
  };
}

/** Read the elevated key used only by trusted server-side model-config code. */
export function getSupabaseServerConfig(): SupabaseServerConfig {
  const publicConfig = getSupabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Supabase server secret is not configured.");
  }
  if (secretKey === publicConfig.publishableKey || secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a server-side secret key.");
  }

  return { ...publicConfig, secretKey };
}
