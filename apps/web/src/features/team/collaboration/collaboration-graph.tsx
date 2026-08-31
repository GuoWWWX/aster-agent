import { ArrowRight, GitBranch, MessageSquareText } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  MAX_TEAM_COLLABORATION_OUTPUT_LENGTH,
  type ConversationRunEvent,
  type TeamCollaborationEdgeView,
  type TeamCollaborationNodeView,
  type TeamCollaborationProjection,
} from "@agent/protocol";

import type { AgentClient } from "../../../runtime/agent-client.js";
import { cn } from "../../../lib/cn.js";
import { resolveAgentAvatarIcon } from "../agent-avatar.js";
import "./collaboration-graph.css";

export type CollaborationGraphVariant = "conversation" | "embedded" | "full" | "mini";

const NODE_WIDTH = 156;
const NODE_HEIGHT = 100;
const CANVAS_PADDING = 42;

export function CollaborationGraph({
  onOpenConversation,
  projection,
  title,
  variant,
}: {
  onOpenConversation?: (conversationId: string) => void;
  projection: TeamCollaborationProjection;
  title?: string;
  variant: CollaborationGraphVariant;
}): ReactElement {
  const markerPrefix = useId().replaceAll(":", "");
  const isMini = variant === "mini";
  const geometry = useMemo(
    () => graphGeometry(projection.nodes, isMini),
    [isMini, projection.nodes],
  );
  const nodesById = useMemo(
    () => new Map(projection.nodes.map((node) => [node.id, node])),
    [projection.nodes],
  );
  const edgeKeys = useMemo(
    () => new Set(projection.edges.map((edge) => edgeKey(edge.fromNodeId, edge.toNodeId))),
    [projection.edges],
  );
  const handleNodeKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    conversationId: string | null,
  ): void => {
    if (conversationId === null || onOpenConversation === undefined) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpenConversation(conversationId);
  };

  return (
    <section
      className={cn(
        "@container grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)]",
        variant === "mini" && "h-[86px] grid-rows-[minmax(0,1fr)] border-[color-mix(in_srgb,var(--app-border)_78%,transparent)] bg-[var(--app-panel-subtle)]",
        variant === "embedded" && "min-h-[190px] max-h-[290px]",
        variant === "conversation" && "mx-auto mt-1 mb-3 min-h-[260px] max-h-[430px] w-[min(960px,calc(100%-12px))] shadow-[0_8px_24px_color-mix(in_srgb,var(--app-foreground)_8%,transparent)]",
        variant === "full" && "h-full min-h-[420px]",
      )}
      data-empty={projection.nodes.length === 0}
      data-variant={variant}
      aria-label={title ?? "Agent 团队协作图"}
    >
      {isMini ? null : (
        <header className="flex min-h-[38px] min-w-0 items-center justify-between gap-2 border-b border-[var(--app-border)] px-[10px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
          <div className="flex min-w-0 items-center gap-[5px] text-[var(--app-foreground)]">
            <GitBranch aria-hidden="true" className="shrink-0 text-[var(--app-accent)]" size={14} />
            <strong className="overflow-hidden text-[length:var(--app-font-size-body)] text-ellipsis whitespace-nowrap">{title ?? "Agent 协作计划与实时通信"}</strong>
          </div>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {projection.plan === null ? "尚未发布计划" : `计划 v${projection.plan.revision}`}
            {` · ${projection.summary.messageCount} 条消息`}
          </span>
        </header>
      )}

      {projection.nodes.length === 0 ? (
        <div className="flex min-h-[92px] items-center justify-center gap-[6px] p-3 text-center text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
          <MessageSquareText aria-hidden="true" size={16} />
          <span>Team Lead 领取任务后，这里会显示计划路线和真实通信。</span>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto bg-[var(--app-canvas)] [background-image:radial-gradient(circle,color-mix(in_srgb,var(--app-border)_72%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
          <svg
            aria-hidden="true"
            className={cn("block h-full w-full", isMini ? "min-h-[84px]" : "min-h-[150px]")}
            preserveAspectRatio="xMidYMid meet"
            viewBox={`${geometry.minX} ${geometry.minY} ${geometry.width} ${geometry.height}`}
          >
            <defs>
              {(["planned", "observed", "ad_hoc", "skipped"] as const).map((state) => (
                <marker
                  id={`${markerPrefix}-${state}`}
                  key={state}
                  markerHeight="7"
                  markerUnits="strokeWidth"
                  markerWidth="7"
                  orient="auto"
                  refX="6"
                  refY="3.5"
                  viewBox="0 0 7 7"
                >
                  <path className={edgeMarkerClassName(state)} d="M0,0 L7,3.5 L0,7 Z" />
                </marker>
              ))}
            </defs>

            <g>
              {projection.edges.map((edge) => {
                const from = nodesById.get(edge.fromNodeId);
                const to = nodesById.get(edge.toNodeId);
                if (from === undefined || to === undefined) return null;
                const path = edgePath({
                  from,
                  hasReciprocal: edgeKeys.has(edgeKey(edge.toNodeId, edge.fromNodeId)),
                  isMini,
                  to,
                });
                const flowing = edgeIsFlowing(edge.state, from.runStatus);
                return (
                  <path
                    className={edgePathClassName(edge.state, flowing)}
                    d={path}
                    key={edge.id}
                    markerEnd={`url(#${markerPrefix}-${edge.state})`}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>

            <g>
              {projection.nodes.map((node) => {
                const clickable = node.conversationId !== null && onOpenConversation !== undefined;
                const AvatarIcon = node.avatarIcon === null
                  ? null
                  : resolveAgentAvatarIcon(node.avatarIcon);
                const outputLines = collaborationOutputLines(node);
                return (
                  <g
                    aria-label={`${node.name}，${node.role}，${runStatusLabel(node.runStatus)}${node.latestOutput === null ? "" : `，最新输出：${node.latestOutput}`}`}
                    className={cn("group focus:outline-none", clickable && "cursor-pointer")}
                    data-clickable={clickable}
                    data-kind={node.kind}
                    data-status={node.runStatus}
                    key={node.id}
                    role={clickable ? "button" : "img"}
                    tabIndex={clickable ? 0 : undefined}
                    transform={`translate(${node.position.x} ${node.position.y})`}
                    onClick={() => {
                      if (clickable) onOpenConversation(node.conversationId!);
                    }}
                    onKeyDown={(event) => handleNodeKeyDown(event, node.conversationId)}
                  >
                    {isMini ? (
                      <>
                        <circle className={nodeSurfaceClassName(node.kind, clickable)} r="16" />
                        {AvatarIcon === null ? (
                          <text className="fill-[var(--app-foreground)] text-[11px] font-bold" dominantBaseline="middle" textAnchor="middle">{nodeInitial(node.name)}</text>
                        ) : (
                          <AvatarIcon
                            aria-hidden="true"
                            className="text-[var(--app-accent)]"
                            data-agent-icon={node.avatarIcon}
                            height={15}
                            strokeWidth={1.8}
                            width={15}
                            x={-7.5}
                            y={-7.5}
                          />
                        )}
                        <circle className={nodeStatusClassName(node.runStatus)} cx="12" cy="-12" r="4" />
                      </>
                    ) : (
                      <>
                        <rect className={nodeSurfaceClassName(node.kind, clickable)} height={NODE_HEIGHT} rx="8" width={NODE_WIDTH} x={-NODE_WIDTH / 2} y={-NODE_HEIGHT / 2} />
                        <circle className="fill-[var(--app-panel-subtle)] stroke-[var(--app-border)] stroke-[1.25]" cx={-NODE_WIDTH / 2 + 25} cy="-20" r="14" />
                        {AvatarIcon === null ? (
                          <text className="fill-[var(--app-foreground)] text-[11px] font-bold" dominantBaseline="middle" textAnchor="middle" x={-NODE_WIDTH / 2 + 25} y="-20">{nodeInitial(node.name)}</text>
                        ) : (
                          <AvatarIcon
                            aria-hidden="true"
                            className="text-[var(--app-accent)]"
                            data-agent-icon={node.avatarIcon}
                            height={15}
                            strokeWidth={1.8}
                            width={15}
                            x={-NODE_WIDTH / 2 + 17.5}
                            y={-27.5}
                          />
                        )}
                        <text className="fill-[var(--app-foreground)] text-[12px] font-bold" x={-NODE_WIDTH / 2 + 48} y="-24">{truncate(node.name, 14)}</text>
                        <text className="fill-[var(--app-muted-foreground)] text-[10px]" x={-NODE_WIDTH / 2 + 48} y="-5">{truncate(node.role, 16)}</text>
                        <line className="stroke-[var(--app-border)] [stroke-width:1]" x1={-NODE_WIDTH / 2 + 10} x2={NODE_WIDTH / 2 - 10} y1="9" y2="9" />
                        <text
                          className={cn(
                            "text-[9px]",
                            node.latestOutput === null
                              ? "fill-[var(--app-muted-foreground)]"
                              : "fill-[var(--app-foreground)]",
                          )}
                          x={-NODE_WIDTH / 2 + 10}
                          y="26"
                        >
                          {outputLines.map((line, index) => (
                            <tspan
                              key={`${node.id}-output-${index}`}
                              x={-NODE_WIDTH / 2 + 10}
                              dy={index === 0 ? 0 : 13}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                        <circle className={nodeStatusClassName(node.runStatus)} cx={NODE_WIDTH / 2 - 10} cy={-NODE_HEIGHT / 2 + 10} r="4" />
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      {isMini || projection.nodes.length === 0 ? null : (
        <footer className="flex min-h-[30px] min-w-0 items-center gap-2 border-t border-[var(--app-border)] bg-[var(--app-panel)] px-[10px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
          <LegendItem label="计划路线" state="planned" />
          <LegendItem label="已发生" state="observed" />
          <LegendItem label="计划外" state="ad_hoc" />
          <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap">
            {projection.summary.participantCount} 个 Agent · {projection.summary.observedRouteCount} 条活跃路线
          </span>
        </footer>
      )}

      <ul className="sr-only">
        {projection.nodes.map((node) => (
          <li key={node.id}>
            {node.name}：{node.role}，{runStatusLabel(node.runStatus)}
            {node.latestOutput === null ? "" : `，最新输出：${node.latestOutput}`}
          </li>
        ))}
        {projection.edges.map((edge) => (
          <li key={edge.id}>
            {nodesById.get(edge.fromNodeId)?.name ?? "未知 Agent"}
            <ArrowRight aria-hidden="true" size={12} />
            {nodesById.get(edge.toNodeId)?.name ?? "未知 Agent"}：
            {edge.purposes.join("、")}，{edge.messageCount} 条消息
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CollaborationProjectionGraph({
  agentClient,
  onOpenConversation,
  title,
  variant,
  workItemId,
}: {
  agentClient: AgentClient;
  onOpenConversation?: (conversationId: string) => void;
  title?: string;
  variant: Exclude<CollaborationGraphVariant, "mini">;
  workItemId: string;
}): ReactElement {
  const [projection, setProjection] = useState<TeamCollaborationProjection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const next = await agentClient.getTeamCollaborationProjection(workItemId);
        if (!active) return;
        setProjection(next);
        setError(null);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "协作图加载失败。");
      }
    };
    void load();
    const dispose = agentClient.onConversationRunEvent((event) => {
      if (event.type === "assistant.delta") {
        setProjection((current) => current === null
          ? current
          : applyCollaborationAssistantDelta(current, event));
        return;
      }
      if (
        event.type === "conversation.updated"
        || event.type === "run.started"
        || event.type === "run.finished"
        || event.type === "tool.completed"
      ) void load();
    });
    return () => {
      active = false;
      dispose();
    };
  }, [agentClient, workItemId]);

  if (error !== null && projection === null) {
    return <div className="flex min-h-[92px] items-center justify-center p-3 text-center text-[length:var(--app-font-size-auxiliary)] text-[var(--app-destructive)]" role="alert">{error}</div>;
  }
  if (projection === null) {
    return <div className="flex min-h-[92px] items-center justify-center p-3 text-center text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]" role="status">正在加载 Agent 协作图…</div>;
  }
  return (
    <CollaborationGraph
      projection={projection}
      variant={variant}
      {...(onOpenConversation === undefined ? {} : { onOpenConversation })}
      {...(title === undefined ? {} : { title })}
    />
  );
}

export function applyCollaborationAssistantDelta(
  projection: TeamCollaborationProjection,
  event: Extract<ConversationRunEvent, { type: "assistant.delta" }>,
): TeamCollaborationProjection {
  let changed = false;
  const nodes = projection.nodes.map((node) => {
    if (node.conversationId !== event.conversationId) return node;
    changed = true;
    const previous = node.latestOutputRunId === event.runId
      ? node.latestOutput ?? ""
      : "";
    return {
      ...node,
      latestOutput: collaborationOutputExcerpt(`${previous}${event.delta}`),
      latestOutputRunId: event.runId,
    };
  });
  return changed ? { ...projection, nodes } : projection;
}

function LegendItem({
  label,
  state,
}: {
  label: string;
  state: "ad_hoc" | "observed" | "planned";
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block w-[15px] border-t-2 border-dashed",
          state === "planned" && "border-[var(--app-muted-foreground)]",
          state === "observed" && "border-[var(--app-accent)]",
          state === "ad_hoc" && "border-[var(--app-destructive)]",
        )}
      />
      {label}
    </span>
  );
}

function edgePathClassName(
  state: TeamCollaborationEdgeView["state"],
  flowing: boolean,
): string {
  return cn(
    "fill-none [stroke-width:1.65] [vector-effect:non-scaling-stroke]",
    state === "planned" && "stroke-[var(--app-muted-foreground)] [stroke-dasharray:6_5]",
    state === "observed" && "stroke-[var(--app-accent)] [stroke-dasharray:8_4]",
    state === "observed" && flowing && "[animation:team-collaboration-flow_1.1s_linear_infinite] motion-reduce:animate-none",
    state === "ad_hoc" && "stroke-[var(--app-destructive)] [stroke-dasharray:3_4]",
    state === "ad_hoc" && flowing && "[animation:team-collaboration-flow_.9s_linear_infinite] motion-reduce:animate-none",
    state === "skipped" && "stroke-[color-mix(in_srgb,var(--app-muted-foreground)_48%,transparent)] [stroke-dasharray:2_5]",
  );
}

function edgeIsFlowing(
  state: TeamCollaborationEdgeView["state"],
  senderStatus: TeamCollaborationNodeView["runStatus"],
): boolean {
  return senderStatus === "running" && (state === "observed" || state === "ad_hoc");
}

function edgeMarkerClassName(state: TeamCollaborationEdgeView["state"]): string {
  return cn(
    state === "planned" && "fill-[var(--app-muted-foreground)]",
    state === "observed" && "fill-[var(--app-accent)]",
    state === "ad_hoc" && "fill-[var(--app-destructive)]",
    state === "skipped" && "fill-[color-mix(in_srgb,var(--app-muted-foreground)_48%,transparent)]",
  );
}

function nodeSurfaceClassName(
  kind: TeamCollaborationNodeView["kind"],
  clickable: boolean,
): string {
  return cn(
    "fill-[var(--app-panel)] stroke-[var(--app-border)] [stroke-width:1.25]",
    kind === "team_lead" && "fill-[color-mix(in_srgb,var(--app-accent)_9%,var(--app-panel))] stroke-[color-mix(in_srgb,var(--app-accent)_52%,var(--app-border))]",
    clickable && "group-hover:stroke-[var(--app-accent)] group-hover:[stroke-width:2] group-focus-visible:stroke-[var(--app-accent)] group-focus-visible:[stroke-width:2]",
  );
}

function nodeStatusClassName(status: TeamCollaborationNodeView["runStatus"]): string {
  return cn(
    "fill-[var(--app-muted-foreground)] stroke-[var(--app-panel)] [stroke-width:2]",
    status === "running" && "fill-[var(--app-accent)]",
    status === "completed" && "fill-[color-mix(in_srgb,var(--app-accent)_64%,#22c55e)]",
    (status === "failed" || status === "blocked") && "fill-[var(--app-destructive)]",
  );
}

function graphGeometry(
  nodes: readonly TeamCollaborationNodeView[],
  isMini: boolean,
): {
  height: number;
  minX: number;
  minY: number;
  width: number;
} {
  if (nodes.length === 0) return { height: 160, minX: 0, minY: 0, width: 480 };
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  const nodeWidth = isMini ? 32 : NODE_WIDTH;
  const nodeHeight = isMini ? 32 : NODE_HEIGHT;
  const minX = Math.min(...xs) - nodeWidth / 2 - CANVAS_PADDING;
  const maxX = Math.max(...xs) + nodeWidth / 2 + CANVAS_PADDING;
  const minY = Math.min(...ys) - nodeHeight / 2 - CANVAS_PADDING;
  const maxY = Math.max(...ys) + nodeHeight / 2 + CANVAS_PADDING;
  return {
    height: Math.max(150, maxY - minY),
    minX,
    minY,
    width: Math.max(420, maxX - minX),
  };
}

function edgePath({
  from,
  hasReciprocal,
  isMini,
  to,
}: {
  from: TeamCollaborationNodeView;
  hasReciprocal: boolean;
  isMini: boolean;
  to: TeamCollaborationNodeView;
}): string {
  const deltaX = to.position.x - from.position.x;
  const deltaY = to.position.y - from.position.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return `M ${from.position.x} ${from.position.y}`;

  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const routeOffset = hasReciprocal ? -10 : 0;
  const halfWidth = isMini ? 16 : NODE_WIDTH / 2;
  const halfHeight = isMini ? 16 : NODE_HEIGHT / 2;
  const horizontalClip = Math.abs(unitX) < Number.EPSILON
    ? Number.POSITIVE_INFINITY
    : halfWidth / Math.abs(unitX);
  const verticalClip = Math.abs(unitY) < Number.EPSILON
    ? Number.POSITIVE_INFINITY
    : halfHeight / Math.abs(unitY);
  const clipDistance = Math.min(horizontalClip, verticalClip);
  const offsetX = perpendicularX * routeOffset;
  const offsetY = perpendicularY * routeOffset;
  const startX = from.position.x + offsetX + unitX * clipDistance;
  const startY = from.position.y + offsetY + unitY * clipDistance;
  const endX = to.position.x + offsetX - unitX * clipDistance;
  const endY = to.position.y + offsetY - unitY * clipDistance;
  return `M ${startX} ${startY} L ${endX} ${endY}`;
}

function edgeKey(fromNodeId: string, toNodeId: string): string {
  return JSON.stringify([fromNodeId, toNodeId]);
}

function nodeInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "A";
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length <= maxLength
    ? value
    : `${characters.slice(0, maxLength - 1).join("")}…`;
}

function collaborationOutputExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= MAX_TEAM_COLLABORATION_OUTPUT_LENGTH
    ? normalized
    : `…${characters.slice(-(MAX_TEAM_COLLABORATION_OUTPUT_LENGTH - 1)).join("")}`;
}

function collaborationOutputLines(node: TeamCollaborationNodeView): string[] {
  if (node.latestOutput === null) {
    return [node.runStatus === "running" || node.runStatus === "queued"
      ? "等待 Agent 输出…"
      : "暂无输出"];
  }
  const characters = Array.from(node.latestOutput);
  const visibleCharacters = characters.length <= 28
    ? characters
    : ["…", ...characters.slice(-27)];
  const firstLine = visibleCharacters.slice(0, 14).join("");
  const secondLine = visibleCharacters.slice(14, 28).join("");
  return secondLine.length === 0 ? [firstLine] : [firstLine, secondLine];
}

function runStatusLabel(status: TeamCollaborationNodeView["runStatus"]): string {
  if (status === "running") return "运行中";
  if (status === "queued") return "等待中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "blocked") return "已阻塞";
  return "空闲";
}
