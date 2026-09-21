type RecentProject = {
  name: string;
  status: string;
  lastConversationAt?: string | null;
};

function conversationTime(project: RecentProject) {
  if (!project.lastConversationAt) return 0;
  const value = Date.parse(project.lastConversationAt);
  return Number.isFinite(value) ? value : 0;
}

/** Most recently discussed projects come first; untouched projects keep a stable fallback order. */
export function orderProjectsByRecentConversation<T extends RecentProject>(projects: T[]) {
  return [...projects].sort((left, right) => {
    const timeDifference = conversationTime(right) - conversationTime(left);
    if (timeDifference !== 0) return timeDifference;
    if (left.status === "active" && right.status !== "active") return -1;
    if (left.status !== "active" && right.status === "active") return 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
}
