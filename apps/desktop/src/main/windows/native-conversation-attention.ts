import { app, nativeImage, Notification, type BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@agent/protocol";
import type { AgentDatabase } from "../storage/agent-database.js";
import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import { ConversationAttention, subscribeConversationAttention } from "./conversation-attention.js";
import { unreadBadgePng } from "./unread-badge.js";

export function attachNativeConversationAttention(window: BrowserWindow, database: AgentDatabase): () => void {
  const notifications = new Set<Notification>();
  const onError = (error: unknown): void => reportMainError(toMainAgentError(error, { operation: "conversation.notification" }), error);
  const attention = new ConversationAttention({
    conversations: () => database.listConversations(), questions: () => database.listUserQuestions(),
    result: (id, runId) => database.getConversationRunOutcome(id, runId)?.result ?? null,
    badge: (count) => {
      if (window.isDestroyed()) return;
      if (process.platform === "win32") window.setOverlayIcon(count === 0 ? null : nativeImage.createFromBuffer(unreadBadgePng(count)), `${count} 个未读对话`);
      else app.setBadgeCount(count);
    },
    notify: (title, body, conversationId) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body, silent: false });
      notifications.add(notification);
      notification.once("click", () => {
        notifications.delete(notification);
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show(); window.focus();
        window.webContents.send(IPC_CHANNELS.conversationRunEvent, { type: "notification.activated", conversationId });
      });
      notification.once("close", () => { notifications.delete(notification); });
      notification.once("failed", (_event, error) => { notifications.delete(notification); onError(new Error(error)); });
      notification.show();
    }, onError,
  });
  const unsubscribe = subscribeConversationAttention((event) => attention.handle(event));
  return () => { unsubscribe(); attention.dispose(); for (const notification of notifications) notification.close(); notifications.clear(); };
}
