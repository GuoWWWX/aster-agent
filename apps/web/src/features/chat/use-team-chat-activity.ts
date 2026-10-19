import { useEffect, useState } from "react";
import type { TeamInstanceView } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { teamChatTabId } from "./workbench-tabs.js";

// Read a bounded page and the persisted user cursor; looking at activity never marks a group read.
export function useTeamChatActivity(client: AgentClient, instances: readonly TeamInstanceView[], open: boolean, retry: number): { sessions: ProjectSession[]; loadError: boolean } {
  const [loadError, setLoadError] = useState(false);
  const [groups, setGroups] = useState<Record<string, ProjectSession>>({});
  const key = JSON.stringify(instances.filter(instance => !instance.isArchived).map(instance => [instance.id, instance.name, instance.projectId, instance.teamId]));
  useEffect(() => {
    let disposed = false;
    const targets = JSON.parse(key) as [string, string, string | null, string][];
    if (targets.length === 0) return undefined;
    let failed = false;
    const versions = new Map<string, number>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const load = async ([id, title, projectId, teamId]: typeof targets[number]): Promise<void> => {
      const version = (versions.get(id) ?? 0) + 1; versions.set(id, version);
      try {
        const page = await client.readTeamChat({ teamInstanceId: id, limit: 30 });
        if (disposed || versions.get(id) !== version) return;
        const latest = page.messages.at(-1);
        const running = page.activity?.status === "working" || page.activity?.status === "coordinating";
        const unread = page.messages.some(message => message.senderConversationId !== null && message.sequence > page.userReadSequence);
        setGroups(current => ({ ...current, [id]: {
          id: teamChatTabId(id), title, projectId, teamId, parentConversationId: null, threadKind: "agent",
          activeRunId: running ? id : null, hasUnreadResult: unread || (page.activity?.status === "failed" && (latest?.sequence ?? 0) > page.userReadSequence),
          lastRunStatus: page.activity?.status === "failed" ? "failed" : running ? "running" : "completed",
          isArchived: false, isPinned: false, modelSelection: null, agentId: null, workspaceRootPath: null,
          ...(latest === undefined ? {} : { updatedAt: latest.createdAt }),
        } }));
      } catch {
        if (!disposed) { failed = true; setLoadError(true); }
      }
    };
    let index = 0;
    void Promise.all(Array.from({ length: Math.min(targets.length, 4) }, async () => {
      while (!disposed && index < targets.length) await load(targets[index++]!);
    })).then(() => { if (!disposed && !failed) setLoadError(false); });
    const unsubscribe = client.onConversationRunEvent(event => {
      if (event.type !== "collaboration.changed") return;
      for (const target of targets) {
        if (event.teamInstanceId !== target[0]) continue;
        clearTimeout(timers.get(target[0]));
        timers.set(target[0], setTimeout(() => { timers.delete(target[0]); void load(target); }, 100));
      }
    });
    return () => { disposed = true; unsubscribe(); for (const timer of timers.values()) clearTimeout(timer); };
  }, [client, key, open, retry]);
  return { sessions: instances.flatMap(instance => !instance.isArchived && groups[instance.id] !== undefined ? [groups[instance.id]!] : []), loadError };
}
