import type { DesktopBridge } from "@agent/protocol";

import type { AgentClient } from "./agent-client.js";
import { DesktopAgentClientAdapter } from "./desktop-agent-client.js";
import { MockAgentClient } from "./mock-agent-client.js";

declare global {
  interface Window {
    agentDesktop?: DesktopBridge;
  }
}

/**
 * Host detection is intentionally confined to the runtime composition root.
 * React components receive an AgentClient and never read Electron globals.
 */
export function createAgentClientForCurrentHost(): AgentClient {
  const desktopBridge = window.agentDesktop;

  return desktopBridge === undefined
    ? new MockAgentClient()
    : new DesktopAgentClientAdapter(desktopBridge);
}
