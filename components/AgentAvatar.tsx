"use client";

import { useEffect, useState } from "react";
import type { ModelAgentType } from "../lib/model-config/catalog";
import type { AgentId } from "./types";

type AvatarMap = Partial<Record<ModelAgentType, string | null>>;

const uiAgentTypes: Record<AgentId, ModelAgentType> = {
  planner: "planning",
  coder: "coding",
  designer: "design",
  client: "client",
  buyer: "procurement",
  marketing: "marketing",
};

let avatarCache: AvatarMap = {};
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export async function refreshAgentAvatars() {
  if (loading) return loading;
  loading = fetch("/api/agents/avatars", { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => null) as { avatars?: AvatarMap } | null;
      if (response.ok && payload?.avatars) avatarCache = payload.avatars;
      loaded = true;
      notify();
    })
    .catch(() => {
      loaded = true;
      notify();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useAgentAvatarUrl(agentType: ModelAgentType) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => avatarCache[agentType] ?? null);

  useEffect(() => {
    const update = () => setAvatarUrl(avatarCache[agentType] ?? null);
    listeners.add(update);
    if (!loaded) void refreshAgentAvatars();
    return () => {
      listeners.delete(update);
    };
  }, [agentType]);

  return avatarUrl;
}

export function AgentAvatar({
  agentId,
  agentType,
  initials,
  className,
}: {
  agentId?: AgentId;
  agentType?: ModelAgentType;
  initials: string;
  className: string;
}) {
  const resolvedType = agentType ?? (agentId ? uiAgentTypes[agentId] : "planning");
  const avatarUrl = useAgentAvatarUrl(resolvedType);

  return (
    <span className={`${className} overflow-hidden`} aria-hidden="true">
      {avatarUrl ? (
        // Supabase public Storage URL selected by a workspace member.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : initials}
    </span>
  );
}
