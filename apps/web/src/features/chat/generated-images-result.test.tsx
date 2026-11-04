// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { conversationToolItemSchema } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { GeneratedImagesResult } from "./generated-images-result.js";
import { imageGenerationDeliveries } from "./image-generation-deliveries.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const id = "00000000-0000-4000-8000-000000000001", runId = "00000000-0000-4000-8000-000000000002";
const tool = conversationToolItemSchema.parse({ id, conversationId: id, runId, name: "generate_images", arguments: '{"count":2}', result: null,
  kind: "tool", status: "running", createdAt: "2026-10-19T00:00:00Z", diff: null });

it("keeps one placeholder per requested image and anchors output outside collapsed work", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  act(() => root.render(<GeneratedImagesResult agentClient={new MockAgentClient()} item={tool} />));
  expect(node.textContent).toContain("正在生成 1/2"); expect(node.textContent).toContain("正在生成 2/2");
  expect(imageGenerationDeliveries([tool], [{ id: "work", runIds: [runId] }]).get("work")).toEqual([tool]);
  expect(imageGenerationDeliveries([tool], [{ id: "work", runIds: [runId] }, { id: "reply", runId }]).get("reply")).toEqual([tool]);
  act(() => root.unmount());
});

it("loads every stored output and opens the existing viewer", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  vi.spyOn(client,"readConversationAttachmentPreview").mockResolvedValue({ data: "AQID", mimeType: "image/png" });
  const images = [1,2].map(n => ({ id: `00000000-0000-4000-8000-00000000000${n}`, conversationId: id, messageId: id,
    name: `generated-${n}.png`, source: "generated", mimeType: "image/png", kind: "image", createdAt: tool.createdAt,
    contextTokens: 1024, projectPath: null, sizeBytes: 3, truncated: false }));
  const item = { ...tool, status: "completed" as const, result: JSON.stringify({ ok: true, value: { images, count: 2, requestedCount: 2, modelId: "image", providerId: id } }) };
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node), listener = vi.fn();
  window.addEventListener("md-king:open-media-preview", listener);
  await act(async () => { root.render(<GeneratedImagesResult agentClient={client} item={item} />); await Promise.resolve(); });
  expect(node.querySelectorAll("img")).toHaveLength(2);
  expect(node.querySelector('[aria-label="生成的图片"]')?.className).toContain("overflow-x-auto");
  act(() => node.querySelector("button")!.click()); expect(listener).toHaveBeenCalledOnce();
  act(() => root.unmount()); window.removeEventListener("md-king:open-media-preview", listener);
});
