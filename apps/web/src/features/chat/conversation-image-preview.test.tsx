// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { conversationMessageItemSchema, conversationToolItemSchema, type ConversationAttachment } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MediaPreviewDialogHost, useMediaPreview } from "../../components/media/image-viewer.js";
import { ConversationImagePreviewScope, conversationPreviewImages, imageDisplayName } from "./conversation-image-preview.js";

const conversationId = "00000000-0000-4000-8000-000000000001", imageId = "00000000-0000-4000-8000-000000000002";
const date = "2026-10-19T00:00:00Z";
const image: ConversationAttachment = { id: imageId, conversationId, messageId: null, kind: "image", name: `generated-${imageId}.png`,
  source: "generated", mimeType: "image/png", contextTokens: 1024, createdAt: date, sizeBytes: 3, truncated: false, projectPath: null };
const message = (id: string, attachments: ConversationAttachment[], content = "") => conversationMessageItemSchema.parse({ id, conversationId,
  runId: null, kind: "message", role: "user", status: "completed", content, attachments, createdAt: date, modelId: null });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("collects images from messages, collapsed tools and Markdown without duplicates or loading bytes", async () => {
  const client = new MockAgentClient(), read = vi.spyOn(client, "readConversationAttachmentPreview").mockResolvedValue({ mimeType: "image/png", data: "AQID" });
  const generated = conversationToolItemSchema.parse({ id: conversationId, conversationId, runId: conversationId, kind: "tool", createdAt: date,
    name: "generate_images", arguments: "{}", status: "completed", diff: null, result: JSON.stringify({ ok: true, value: { images: [image] } }) });
  const screenshot = { ...image, id: "00000000-0000-4000-8000-000000000003", source: "browser", name: "页面截图.jpg" };
  const images = conversationPreviewImages([message(imageId, [image], "![参考](https://example.test/ref.png)"), generated,
    { ...generated, id: screenshot.id, result: JSON.stringify({ ok: true, value: { images: [screenshot] } }) }], conversationId, client);
  expect(images.map(entry => entry.label)).toEqual(["生成图片", "参考", "页面截图.jpg"]);
  expect(read).not.toHaveBeenCalled();
  expect(await images[0]?.load()).toBe("data:image/png;base64,AQID");
  expect(read).toHaveBeenCalledOnce();
  expect(imageDisplayName({ ...image, projectPath: "D:/pictures/shot.png" })).toBe("D:/pictures/shot.png");
});

it("loads earlier conversation pages only when opening and reads the selected old image on navigation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const old = { ...image, id: "00000000-0000-4000-8000-000000000003", name: "old.png" };
  const current = message(imageId, [image]), earlier = message(old.id, [old]);
  const client = new MockAgentClient();
  const pages = vi.spyOn(client, "listConversationTimelinePage").mockResolvedValueOnce({ items: [current], hasMore: true, nextBeforeSequence: 10 })
    .mockResolvedValueOnce({ items: [earlier], hasMore: false, nextBeforeSequence: null });
  const read = vi.spyOn(client, "readConversationAttachmentPreview").mockResolvedValue({ mimeType: "image/png", data: "OLD" });
  function Trigger() { const open = useMediaPreview(); return <button onClick={() => open({ imageKey: image.id, src: "data:image/png;base64,CURRENT", title: "生成图片" })}>预览</button>; }
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  await act(async () => { root.render(<TooltipProvider><ConversationImagePreviewScope client={client} conversationId={conversationId} timeline={[current]}>
    <Trigger /></ConversationImagePreviewScope><MediaPreviewDialogHost /></TooltipProvider>); await Promise.resolve(); });
  expect(pages).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  await act(async () => { node.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
  expect(pages).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain("2 / 2");
  expect(document.body.textContent).not.toContain(image.id);
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="上一张图片"]')!.click(); await Promise.resolve(); });
  expect(document.querySelector("img")?.getAttribute("src")).toContain("OLD");
  expect(read).toHaveBeenCalledWith({ conversationId, attachmentId: old.id });
  act(() => root.unmount()); node.remove();
});
