import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@agent/protocol";
import type { BrowserWindow } from "electron";
import { AgentDatabase } from "../storage/agent-database.js";
const fixture = vi.hoisted(() => ({ notifications: [] as { emitter: EventEmitter; title: string; body: string; close: () => void }[], badge: vi.fn(), image: vi.fn((data: Buffer) => data) }));
vi.mock("electron", () => ({
  app: { setBadgeCount: fixture.badge }, nativeImage: { createFromBuffer: fixture.image },
  Notification: class extends EventEmitter {
    public static isSupported(): boolean { return true; }
    public constructor(input: { title: string; body: string }) { super(); fixture.notifications.push({ ...input, emitter: this, close: () => this.close() }); }
    public show(): void {}
    public close(): void { this.emit("close"); }
  },
}));
vi.mock("../errors/agent-error.js", () => ({ reportMainError: vi.fn(), toMainAgentError: (error: unknown) => error }));
import { attachNativeConversationAttention } from "./native-conversation-attention.js";
import { publishConversationAttentionEvent } from "./conversation-attention.js";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fixture.notifications.length = 0; });
it("uses native overlay and notification APIs, restores the window and routes the click to the conversation", () => {
  vi.useFakeTimers();
  const database = new AgentDatabase(":memory:"); const conversation = database.createConversation(null);
  const run = database.createRunWithUserMessage(conversation.id, "test", "fixture"); database.finishRun(run.runId, "completed", null);
  const window = { isDestroyed: () => false, isMinimized: () => true, setOverlayIcon: vi.fn(), restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } };
  const dispose = attachNativeConversationAttention(window as unknown as BrowserWindow, database);
  if (process.platform === "win32") expect(window.setOverlayIcon).toHaveBeenCalledWith(expect.any(Buffer), "1 个未读对话");
  publishConversationAttentionEvent({ type: "run.finished", conversationId: conversation.id, runId: run.runId, status: "completed", error: null });
  vi.advanceTimersByTime(350);
  expect(fixture.notifications[0]).toMatchObject({ title: database.getConversation(conversation.id).title, body: "对话已完成。" });
  fixture.notifications[0]?.emitter.emit("click");
  expect(window.restore).toHaveBeenCalledOnce(); expect(window.show).toHaveBeenCalledOnce(); expect(window.focus).toHaveBeenCalledOnce();
  expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.conversationRunEvent, { type: "notification.activated", conversationId: conversation.id });
  dispose(); publishConversationAttentionEvent({ type: "run.finished", conversationId: conversation.id, runId: crypto.randomUUID(), status: "completed", error: null });
  vi.runAllTimers(); expect(fixture.notifications).toHaveLength(1); database.close();
});
