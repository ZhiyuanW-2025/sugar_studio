import { checkSupabaseConnection } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await checkSupabaseConnection();

    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supabase connection check failed.";
    const isMissingConfiguration = message.startsWith("Supabase is not configured");

    return Response.json(
      {
        ok: false,
        service: "supabase",
        error: message,
      },
      {
        status: isMissingConfiguration ? 503 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
