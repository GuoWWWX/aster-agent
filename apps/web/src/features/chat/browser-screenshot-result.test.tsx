// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationAttachment } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { BrowserScreenshotResult } from "./browser-screenshot-result.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const image: ConversationAttachment = {
  id: "00000000-0000-4000-8000-000000000001", conversationId: "00000000-0000-4000-8000-000000000002",
  messageId: "00000000-0000-4000-8000-000000000003", contextTokens: 1024, createdAt: "2026-10-16T00:00:00Z",
  kind: "image", mimeType: "image/jpeg", name: "browser.jpg", projectPath: null, sizeBytes: 3, source: "browser", truncated: false,
};
it.each([false, true])("loads a stored screenshot lazily and handles missing images (missing=%s)", async (missing) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "readConversationAttachmentPreview");
  if (missing) read.mockRejectedValue(new Error("missing"));
  else read.mockResolvedValue({ data: "AQID", mimeType: "image/jpeg" });
  const preview = vi.fn(); window.addEventListener("md-king:open-media-preview", preview);
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  await act(async () => { root.render(<BrowserScreenshotResult agentClient={client} image={image} />); await Promise.resolve(); });
  expect(read).toHaveBeenCalledWith({ conversationId: image.conversationId, attachmentId: image.id });
  if (missing) expect(node.textContent).toContain("截图无法读取");
  else {
    expect(node.querySelector("img")?.src).toBe("data:image/jpeg;base64,AQID");
    act(() => { node.querySelector("button")!.click(); }); expect(preview).toHaveBeenCalledOnce();
  }
  act(() => root.unmount()); window.removeEventListener("md-king:open-media-preview", preview);
});
