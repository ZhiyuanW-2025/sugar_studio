import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";

export class WorkspaceAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    message: string,
  ) {
    super(message);
  }
}

export async function requireWorkspaceMember() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError && !isAuthSessionMissingError(userError)) {
    throw new WorkspaceAccessError(500, "暂时无法确认登录状态，请稍后重试。");
  }
  if (!user) throw new WorkspaceAccessError(401, "请先登录后继续。");

  const { data, error } = await supabase
    .from("project_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);
  if (error) throw new WorkspaceAccessError(500, "暂时无法确认工作室权限，请稍后重试。");
  if (!data?.length) throw new WorkspaceAccessError(403, "你还不是工作室成员，无法执行此操作。");
  return { supabase, user };
}
