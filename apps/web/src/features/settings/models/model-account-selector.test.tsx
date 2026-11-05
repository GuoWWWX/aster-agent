// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentClient } from "../../../runtime/agent-client.js";
import { MockAgentClient } from "../../../runtime/mock-agent-client.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { ModelAccountSelector } from "./model-account-selector.js";

it("selects existing accounts and opens account management without starting a login", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const providerAccounts = vi.fn<NonNullable<AgentClient["providerAccounts"]>>((request) => Promise.resolve(request.action === "providers"
    ? { action: "providers", providers: [{ kind: "chatgpt", name: "ChatGPT", signInLabel: "Continue with ChatGPT", usageUrl: null }] }
    : { action: "list", connections: [] }));
  const client = Object.assign(new MockAgentClient(), { providerAccounts });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await flush(() => root.render(<ModelAccountSelector agentClient={client} selectedProviderId={null} onModelsChanged={vi.fn()} />));
    expect(container.textContent).not.toContain("Continue with ChatGPT");
    expect(container.querySelector('[aria-label="授权账号"]')?.getAttribute("disabled")).not.toBeNull();
    await flush(() => container.querySelector("button.settings-secondary-button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(useWorkbenchUiStore.getState().settingsSection).toBe("accounts");
    expect(providerAccounts.mock.calls.map(([request]) => request.action)).toEqual(["providers", "list"]);
  } finally { await flush(() => root.unmount()); container.remove(); }
});

async function flush(action: () => unknown): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}
