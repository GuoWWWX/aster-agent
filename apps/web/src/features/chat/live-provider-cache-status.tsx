import { useEffect, useState } from "react";
import { estimateContextTokens, type ConversationContextUsage } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { ProviderCacheStatus, type LiveModelMetrics } from "./context-usage-indicator.js";

/** Transient estimates stay local to the small status bar, outside conversation history. */
export function LiveProviderCacheStatus({ agentClient, conversationId, usage }: {
  agentClient: AgentClient;
  conversationId: string;
  usage: ConversationContextUsage | null;
}) {
  const [live, setLive] = useState<LiveModelMetrics | null>(null);
  useEffect(() => {
    let runId: string | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let firstOutputAt: number | null = null;
    let text = "";
    let reasoning = "";
    let inputTokens: number | null = null;
    let latency: number | null = null;
    const stop = () => { clearInterval(timer); timer = undefined; };
    const publish = () => {
      const outputTokens = estimateContextTokens(text) + estimateContextTokens(reasoning);
      const duration = firstOutputAt === null ? 0 : performance.now() - firstOutputAt;
      setLive({
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        firstTokenLatencyMs: latency,
        outputTokensPerSecond: duration < 250 || outputTokens === 0 ? null : outputTokens * 1000 / duration,
      });
    };
    const unsubscribe = agentClient.onConversationRunEvent(event => {
      if (!("conversationId" in event) || event.conversationId !== conversationId) return;
      if (event.type === "model.request_started") {
        stop(); runId = event.runId; firstOutputAt = null; text = ""; reasoning = "";
        inputTokens = event.estimatedInputTokens ?? null; latency = null;
        publish(); timer = setInterval(publish, 1000);
      } else if ("runId" in event && event.runId === runId) {
        if (event.type === "model.first_token_received") {
          latency = event.latencyMs; firstOutputAt = performance.now(); publish();
        } else if (event.type === "assistant.delta") {
          firstOutputAt ??= performance.now(); text += event.delta;
        } else if (event.type === "assistant.reasoning_delta" && event.kind !== "progress") {
          firstOutputAt ??= performance.now(); reasoning = event.reset ? event.delta : reasoning + event.delta;
        } else if (event.type === "run.finished" || event.type === "tool.started"
          || event.type === "tool.approval_requested" || event.type === "model.retry_updated") {
          stop(); runId = null; text = ""; reasoning = ""; setLive(null);
        }
      }
    });
    return () => { stop(); unsubscribe(); };
  }, [agentClient, conversationId]);
  return <ProviderCacheStatus usage={usage} live={live} />;
}
