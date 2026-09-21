import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";

export class ProjectAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    message: string,
  ) {
    super(message);
  }
}

export async function requireProjectMember(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isAuthSessionMissingError(userError)) {
    throw new ProjectAccessError(500, "暂时无法确认登录状态，请稍后重试。");
  }
  if (!user) {
    throw new ProjectAccessError(401, "请先登录后继续。");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("id, role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    throw new ProjectAccessError(500, "暂时无法确认项目权限，请稍后重试。");
  }
  if (!membership) {
    throw new ProjectAccessError(403, "你不是该项目成员，无法执行此操作。");
  }

  return { supabase, user, membership };
}
