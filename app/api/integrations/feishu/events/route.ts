import { enqueueFeishuEvent } from "../../../../../lib/feishu/event-service";
import { getFeishuConfig } from "../../../../../lib/feishu/config";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const root = asRecord(body);
  if (typeof root.challenge === "string") {
    const config = getFeishuConfig();
    if (!config.verificationToken || root.token !== config.verificationToken) {
      return Response.json({ error: "Invalid verification token." }, { status: 401, headers });
    }
    return Response.json({ challenge: root.challenge }, { headers });
  }
  if (typeof root.encrypt === "string") {
    return Response.json({ error: "Encrypted Feishu callbacks are not enabled in this MVP." }, { status: 400, headers });
  }
  try {
    const config = getFeishuConfig();
    const header = asRecord(root.header);
    if (!config.verificationToken || header.token !== config.verificationToken) {
      return Response.json({ error: "Invalid verification token." }, { status: 401, headers });
    }
    const event = asRecord(root.event);
    const objToken = [event.file_token, event.obj_token, event.document_id].find((value) => typeof value === "string") as string | undefined;
    await enqueueFeishuEvent({
      eventId: typeof header.event_id === "string" ? header.event_id : null,
      eventType: typeof header.event_type === "string" ? header.event_type : "unknown",
      objToken: objToken ?? null,
    });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "Unable to accept Feishu event." }, { status: 500, headers });
  }
}
