import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NewtonClient, type NewtonInquiryTargetResult } from "../newton/server";

export type ProcurementInquiryView = {
  id: string;
  projectId: string;
  status: string;
  mode: "single_round" | "multi_round";
  requirement: string;
  questions: string[];
  timeoutMinutes: number;
  supplierCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  targets: Array<{
    id: string;
    candidateId: string | null;
    itemId: string;
    title: string;
    imageUrl: string | null;
    productUrl: string;
    supplierName: string | null;
    sellerLoginId: string | null;
    status: string;
    followUpStatus: "active" | "ended";
    hasNewReply: boolean;
    lastMessageAt: string | null;
    lastCheckedAt: string | null;
    latestSummary: string | null;
    shopUrl: string | null;
    messages: Array<{ id: string; sender: "buyer" | "seller" | "system"; content: string; sentAt: string | null }>;
  }>;
};

type DbRecord = Record<string, unknown>;

function text(value: unknown) { return typeof value === "string" ? value : null; }
function record(value: unknown): DbRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as DbRecord : {}; }

export function serializeInquiry(row: DbRecord): ProcurementInquiryView {
  const targets = Array.isArray(row.procurement_inquiry_targets) ? row.procurement_inquiry_targets : [];
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    status: String(row.status),
    mode: row.conversation_mode === "single_round" ? "single_round" : "multi_round",
    requirement: String(row.requirement),
    questions: Array.isArray(row.questions) ? row.questions.filter((item): item is string => typeof item === "string") : [],
    timeoutMinutes: Number(row.timeout_minutes),
    supplierCount: Number(row.supplier_count),
    lastError: text(row.last_error),
    lastSyncedAt: text(row.last_synced_at),
    createdAt: String(row.created_at),
    targets: targets.map((rawTarget) => {
      const target = record(rawTarget);
      const messages = Array.isArray(target.procurement_inquiry_messages) ? target.procurement_inquiry_messages : [];
      return {
        id: String(target.id),
        candidateId: text(target.candidate_id),
        itemId: String(target.item_id),
        title: String(target.title),
        imageUrl: text(target.image_url),
        productUrl: String(target.product_url),
        supplierName: text(target.supplier_name),
        sellerLoginId: text(target.seller_login_id),
        status: String(target.status),
        followUpStatus: target.follow_up_status === "ended" ? "ended" : "active",
        hasNewReply: target.has_new_reply === true,
        lastMessageAt: text(target.last_message_at),
        lastCheckedAt: text(target.last_checked_at),
        latestSummary: text(target.latest_summary),
        shopUrl: text(target.shop_url),
        messages: messages.map((rawMessage) => {
          const message = record(rawMessage);
          const sender = message.sender === "buyer" || message.sender === "seller" ? message.sender : "system";
          return { id: String(message.id), sender, content: String(message.content), sentAt: text(message.sent_at) };
        }),
      };
    }),
  };
}

export async function loadProcurementInquiries(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase
    .from("procurement_inquiries")
    .select("id, project_id, status, conversation_mode, requirement, questions, timeout_minutes, supplier_count, last_error, last_synced_at, created_at, procurement_inquiry_targets(id, candidate_id, item_id, title, image_url, product_url, supplier_name, seller_login_id, status, follow_up_status, has_new_reply, last_message_at, last_checked_at, latest_summary, shop_url, ordinal, procurement_inquiry_messages(id, sender, content, sent_at, created_at))")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("ordinal", { referencedTable: "procurement_inquiry_targets", ascending: true })
    .order("created_at", { referencedTable: "procurement_inquiry_targets.procurement_inquiry_messages", ascending: true })
    .limit(20);
  if (error) throw new Error("暂时无法加载询盘记录。");
  return (data ?? []).map((item) => serializeInquiry(item as DbRecord));
}

function matchTarget(result: NewtonInquiryTargetResult, targets: DbRecord[], index: number) {
  return targets.find((target) => result.itemId && String(target.item_id) === result.itemId)
    ?? targets.find((target) => result.productUrl && String(target.product_url) === result.productUrl)
    ?? targets.find((target) => result.sellerLoginId && target.seller_login_id === result.sellerLoginId)
    ?? targets[index];
}

function targetStatus(result: NewtonInquiryTargetResult) {
  const normalized = result.status.toUpperCase();
  if (["ERROR", "STOPPED", "DISCARD"].includes(normalized)) return "failed";
  if (normalized === "FAILED") {
    return result.messages.some((message) => message.sender === "seller") || result.summary ? "replied" : "no_reply";
  }
  if (["SUCCESS", "COMPLETE", "COMPLETED", "END"].includes(normalized)) return "completed";
  if (result.messages.some((message) => message.sender === "seller") || result.summary) return "replied";
  if (["RUNNING", "START", "PENDING", "INIT"].includes(normalized)) return "waiting";
  return "waiting";
}

export async function syncProcurementInquiry(supabase: SupabaseClient, inquiryId: string, projectId: string) {
  const { data: inquiry, error } = await supabase
    .from("procurement_inquiries")
    .select("id, newton_task_id, newton_ww_task_id, status, procurement_inquiry_targets(id, item_id, product_url, seller_login_id, ordinal, follow_up_status, has_new_reply)")
    .eq("id", inquiryId)
    .eq("project_id", projectId)
    .single();
  if (error || !inquiry) throw new Error("没有找到这条询盘记录。");
  if (!inquiry.newton_task_id && !inquiry.newton_ww_task_id) throw new Error("这条询盘尚未成功创建，无法同步回复。");

  const result = await new NewtonClient().getBatchInquiryResult({
    taskId: inquiry.newton_task_id ?? undefined,
    wwTaskId: inquiry.newton_ww_task_id ?? undefined,
  });
  const targets = (inquiry.procurement_inquiry_targets ?? []) as unknown as DbRecord[];
  let replyCount = 0;
  for (const [index, targetResult] of result.targets.entries()) {
    const target = matchTarget(targetResult, targets, index);
    if (!target) continue;
    const status = targetStatus(targetResult);
    if (status === "replied" || status === "completed") replyCount += 1;
    const checkedAt = new Date().toISOString();
    let foundNewSellerReply = false;
    let lastMessageAt: string | null = null;
    if (targetResult.messages.length) {
      const occurrences = new Map<string, number>();
      const rows = targetResult.messages.map((message) => {
        const contentKey = `${message.sender}\n${message.content.trim()}`;
        const occurrence = occurrences.get(contentKey) ?? 0;
        occurrences.set(contentKey, occurrence + 1);
        const stableIdentity = message.externalId
          ? `external:${message.externalId}`
          : `content:${contentKey}\noccurrence:${occurrence}`;
        return {
          inquiry_target_id: String(target.id),
          external_message_id: message.externalId,
          sender: message.sender,
          content: message.content,
          message_hash: createHash("sha256").update(stableIdentity).digest("hex"),
          sent_at: message.sentAt && !Number.isNaN(Date.parse(message.sentAt)) ? new Date(message.sentAt).toISOString() : null,
        };
      });
      const { data: previousMessages, error: previousError } = await supabase.from("procurement_inquiry_messages")
        .select("message_hash")
        .eq("inquiry_target_id", String(target.id));
      if (previousError) throw new Error("暂时无法核对商家聊天记录。");
      const previousHashes = new Set((previousMessages ?? []).map((message) => message.message_hash));
      foundNewSellerReply = rows.some((row) => row.sender === "seller" && !previousHashes.has(row.message_hash));
      lastMessageAt = rows.reduce<string | null>((latest, row) => {
        if (!row.sent_at) return latest;
        return !latest || row.sent_at > latest ? row.sent_at : latest;
      }, null);
      const { error: messageError } = await supabase.from("procurement_inquiry_messages")
        .upsert(rows, { onConflict: "inquiry_target_id,message_hash", ignoreDuplicates: true });
      if (messageError) throw new Error("暂时无法保存商家聊天记录。");

      // Newton can return the same transcript with timestamps represented in
      // different time zones on later polls. Keep the new stable identities
      // and remove legacy copies of the same sender/content pair.
      const stableHashes = new Set(rows.map((row) => row.message_hash));
      const currentPairs = new Set(rows.map((row) => `${row.sender}\n${row.content.trim()}`));
      const { data: storedMessages, error: storedError } = await supabase.from("procurement_inquiry_messages")
        .select("id,sender,content,message_hash")
        .eq("inquiry_target_id", String(target.id));
      if (storedError) throw new Error("暂时无法核对商家聊天记录。");
      const staleIds = (storedMessages ?? [])
        .filter((message) => currentPairs.has(`${message.sender}\n${message.content.trim()}`) && !stableHashes.has(message.message_hash))
        .map((message) => message.id);
      if (staleIds.length > 0) {
        const { error: cleanupError } = await supabase.from("procurement_inquiry_messages").delete().in("id", staleIds);
        if (cleanupError) throw new Error("商家聊天记录已同步，但重复记录清理失败。");
      }
    }
    const { error: targetUpdateError } = await supabase.from("procurement_inquiry_targets").update({
      status,
      latest_summary: targetResult.summary,
      shop_url: targetResult.shopUrl,
      external_updated_at: checkedAt,
      last_checked_at: checkedAt,
      ...(lastMessageAt ? { last_message_at: lastMessageAt } : {}),
      ...(foundNewSellerReply ? { has_new_reply: true } : {}),
    }).eq("id", String(target.id));
    if (targetUpdateError) throw new Error("暂时无法保存商家询价状态。");
  }

  const terminalFailure = ["FAILED", "STOPPED", "DISCARD"].includes(result.status.toUpperCase());
  const status = terminalFailure ? "failed" : result.completed ? "completed" : replyCount > 0 ? "partial" : "waiting";
  const { error: inquiryUpdateError } = await supabase.from("procurement_inquiries").update({
    status,
    newton_ww_task_id: result.wwTaskId,
    last_synced_at: new Date().toISOString(),
    completed_at: result.completed ? new Date().toISOString() : null,
    last_error: terminalFailure ? "1688 询盘任务未正常完成。" : null,
  }).eq("id", inquiryId);
  if (inquiryUpdateError) throw new Error("暂时无法更新询价记录。");
}

export async function syncDueProcurementFollowUps(supabase: SupabaseClient, limit = 5) {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await supabase.from("procurement_inquiry_targets")
    .select("inquiry_id, last_checked_at, procurement_inquiries!inner(id, project_id)")
    .eq("follow_up_status", "active")
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(limit * 4, limit));
  if (error) throw new Error("暂时无法读取待跟进商家。");

  const due = new Map<string, string>();
  for (const raw of data ?? []) {
    if (due.size >= limit) break;
    const relation = Array.isArray(raw.procurement_inquiries) ? raw.procurement_inquiries[0] : raw.procurement_inquiries;
    if (!relation || typeof relation !== "object") continue;
    const projectId = "project_id" in relation ? relation.project_id : null;
    if (typeof raw.inquiry_id === "string" && typeof projectId === "string") due.set(raw.inquiry_id, projectId);
  }

  const results: Array<{ inquiryId: string; ok: boolean }> = [];
  for (const [inquiryId, projectId] of due) {
    try {
      await syncProcurementInquiry(supabase, inquiryId, projectId);
      results.push({ inquiryId, ok: true });
    } catch {
      results.push({ inquiryId, ok: false });
    }
  }
  return results;
}
