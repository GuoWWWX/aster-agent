// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderAuthenticationSettings } from "./provider-authentication-settings.js";

it("shows one configuration mode while preserving both forms and the shared model list", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const selectApi = vi.fn();
  try {
    await flush(() => root.render(<><ProviderAuthenticationSettings initialMode="api-key" onApiKeyMode={selectApi}
      apiKey={<input aria-label="API credential" defaultValue="draft" />} account={<button>Login provider</button>} /><div>Shared models</div></>));
    const credential = container.querySelector("input")!;
    expect(credential.parentElement?.hidden).toBe(false);
    const account = [...container.querySelectorAll("button")].find((button) => button.textContent === "账号登录")!;
    await flush(() => account.click());
    expect(credential.parentElement?.hidden).toBe(true);
    expect(container.querySelector("div[hidden] input")).toBe(credential);
    expect(container.textContent).toContain("Shared models");
    await flush(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "API Key")!.click());
    expect(credential.parentElement?.hidden).toBe(false);
    expect(credential.value).toBe("draft"); expect(selectApi).toHaveBeenCalledOnce();
  } finally { await flush(() => root.unmount()); container.remove(); }
});

async function flush(action: () => unknown): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}
