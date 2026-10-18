import { setTimeout } from "node:timers/promises";
import type { HtmlPreviewRequest, presentHtmlInputSchema } from "@agent/protocol";
import type { z } from "zod";
import type { ManagedBrowserAutomationPort } from "../windows/managed-browser-controller.js";
import type { ToolExecutionResult } from "../tools/project-tool-registry.js";
import { browserScreenshotAttachment } from "../tools/browser-screenshot-attachment.js";
import type { HtmlPreviewServer } from "./html-preview-server.js";

export type PreviewInspection = { source: Extract<HtmlPreviewRequest, { kind: "code" | "file" }>; width: number; height: number; frames: number; intervalMs: number; actions?: z.infer<typeof presentHtmlInputSchema>["actions"]; signal: AbortSignal };

/** Reuses the isolated preview and managed background browser, with no visible tab or persistent service. */
export class PreviewInspector {
  public constructor(private readonly previews: Pick<HtmlPreviewServer, "create" | "release">, private readonly browser: Pick<ManagedBrowserAutomationPort, "open" | "observe" | "capture" | "interact" | "close">) {}

  public async inspect(input: PreviewInspection): Promise<ToolExecutionResult> {
    input.signal.throwIfAborted();
    const preview = await this.previews.create(input.source);
    let sessionId: string | undefined;
    const close = (): void => { if (sessionId !== undefined) { const id = sessionId; sessionId = undefined; this.browser.close({ sessionId: id }); } };
    try {
      input.signal.throwIfAborted();
      const session = await this.browser.open({ url: preview.url }, { isolated: true, background: { width: input.width, height: input.height }, signal: input.signal });
      sessionId = session.sessionId;
      input.signal.addEventListener("abort", close, { once: true });
      await setTimeout(100, undefined, { signal: input.signal });
      const reference = { sessionId: session.sessionId };
      for (const action of input.actions ?? []) {
        input.signal.throwIfAborted();
        await this.browser.interact({ ...reference, ...(action.action === "click" ? { kind: "click", x: action.x, y: action.y, button: "left", clickCount: 1 } as const : { kind: "key", key: action.key, modifiers: [] } as const) });
        await setTimeout(100, undefined, { signal: input.signal });
      }
      if ((input.actions?.length ?? 0) > 0) {
        // Electron's first hidden capture can return the pre-input surface.
        // Flush it once after interactions; only subsequent frames are evidence.
        await this.browser.capture(reference);
        await setTimeout(250, undefined, { signal: input.signal });
      }
      const observation = await this.browser.observe(reference);
      const modelAttachments = [];
      for (let frame = 0; frame < input.frames; frame += 1) {
        if (frame > 0) await setTimeout(input.intervalMs, undefined, { signal: input.signal });
        input.signal.throwIfAborted();
        const snapshot = await this.browser.capture(reference);
        input.signal.throwIfAborted();
        modelAttachments.push(browserScreenshotAttachment(snapshot, `preview-phase-${frame + 1}.jpg`));
      }
      return { kind: "completed", isError: false, content: JSON.stringify({ ok: true, value: { inspected: true, width: input.width, height: input.height,
        frames: input.frames, intervalMs: input.intervalMs, actions: input.actions ?? [], coordinateSpace: "screenshot_css_pixels", mimeType: modelAttachments[0]?.mimeType,
        observation: { text: observation.text, title: observation.title, viewport: observation.viewport },
        note: "Snapshot-only inspection; the page is now closed. No reusable URL, browserId or element references exist. To verify another state/size, inspect the same source with actions/viewport. Inspect these images before claiming correctness; no final presentation was delivered." } }), modelAttachments };
    } finally {
      input.signal.removeEventListener("abort", close);
      try { close(); } finally { this.previews.release(preview.id, input.source.conversationId); }
    }
  }
}
