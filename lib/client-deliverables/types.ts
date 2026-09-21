export const clientDeliverableTypes = [
  "proposal",
  "meeting_notes",
  "progress_report",
  "change_response",
  "formal_message",
] as const;

export type ClientDeliverableType = (typeof clientDeliverableTypes)[number];
export type ClientDeliverableStatus = "draft" | "in_review" | "approved" | "dispatched" | "archived";

export const clientDeliverableLabels: Record<ClientDeliverableType, string> = {
  proposal: "客户提案",
  meeting_notes: "会议纪要",
  progress_report: "项目进度汇报",
  change_response: "客户修改意见回复",
  formal_message: "正式邮件 / 企业微信回复",
};

export function isClientDeliverableType(value: unknown): value is ClientDeliverableType {
  return typeof value === "string" && clientDeliverableTypes.includes(value as ClientDeliverableType);
}
