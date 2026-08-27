import type { ModelRuntimeStatus } from "@agent/protocol";

import type { AgentClient } from "./agent-client.js";

const cachedStatuses = new WeakMap<AgentClient, ModelRuntimeStatus>();
const pendingRequests = new WeakMap<AgentClient, Promise<ModelRuntimeStatus>>();
const statusVersions = new WeakMap<AgentClient, number>();

export function getCachedModelStatus(agentClient: AgentClient): ModelRuntimeStatus | null {
  return cachedStatuses.get(agentClient) ?? null;
}

export function rememberModelStatus(
  agentClient: AgentClient,
  status: ModelRuntimeStatus,
): ModelRuntimeStatus {
  cachedStatuses.set(agentClient, status);
  statusVersions.set(agentClient, (statusVersions.get(agentClient) ?? 0) + 1);
  return status;
}

export function loadModelStatus(agentClient: AgentClient): Promise<ModelRuntimeStatus> {
  const pending = pendingRequests.get(agentClient);
  if (pending !== undefined) return pending;

  const requestVersion = statusVersions.get(agentClient) ?? 0;
  const request = agentClient.getModelStatus()
    .then((status) => {
      if ((statusVersions.get(agentClient) ?? 0) !== requestVersion) {
        return getCachedModelStatus(agentClient) ?? status;
      }
      return rememberModelStatus(agentClient, status);
    })
    .finally(() => {
      if (pendingRequests.get(agentClient) === request) {
        pendingRequests.delete(agentClient);
      }
    });
  pendingRequests.set(agentClient, request);
  return request;
}
