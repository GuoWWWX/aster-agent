// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/index.js";
import { ProjectImageResult } from "./project-image-result.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it("loads an inline preview and opens the existing image viewer without a browser", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "readProjectPreviewImage").mockResolvedValue({ data: "AQID", mimeType: "image/png" });
  const listener = vi.fn();
  window.addEventListener("md-king:open-media-preview", listener);
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  const projectId = "00000000-0000-4000-8000-000000000001";
  await act(async () => { root.render(<ProjectImageResult agentClient={client} payload={JSON.stringify({ ok: true, value: { image: { projectId, path: "images/demo.png", mimeType: "image/png" } } })} />); await Promise.resolve(); });
  expect(read).toHaveBeenCalledWith({ projectId, path: "demo.png", sourcePath: "images/demo.png" });
  expect(node.querySelector("img")?.src).toBe("data:image/png;base64,AQID");
  expect(node.textContent).toBe("");
  expect(node.querySelector(".conversation-attachment--image-preview")).not.toBeNull();
  act(() => { node.querySelector("button")?.click(); });
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener("md-king:open-media-preview", listener);
  act(() => root.unmount());
});
