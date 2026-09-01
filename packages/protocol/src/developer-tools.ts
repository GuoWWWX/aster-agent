import { z } from "zod";

import { conversationIdSchema } from "./conversation.js";
import { projectIdSchema, relativeProjectPathSchema } from "./project.js";

const sessionIdSchema = z.string().uuid();

export const gitReviewInputSchema = z.object({
  projectId: projectIdSchema,
}).strict();

export const gitWorkingTreeChangeSchema = z.object({
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  isStaged: z.boolean(),
  originalPath: z.string().min(1).max(4_096).nullable(),
  path: relativeProjectPathSchema.refine((value) => value.length > 0),
  status: z.string().length(2),
}).strict();

export const gitBranchSchema = z.object({
  current: z.boolean(),
  name: z.string().min(1).max(512),
  upstream: z.string().min(1).max(512).nullable(),
}).strict();

export const gitReviewSnapshotSchema = z.object({
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  branch: z.string().min(1).max(512).nullable(),
  branches: z.array(gitBranchSchema).max(10_000),
  changes: z.array(gitWorkingTreeChangeSchema).max(20_000),
  isRepository: z.boolean(),
  projectId: projectIdSchema,
  refreshedAt: z.string().datetime(),
  upstream: z.string().min(1).max(512).nullable(),
}).strict();

export const gitFileDiffInputSchema = z.object({
  contextLines: z.number().int().min(0).max(10_000).optional(),
  path: relativeProjectPathSchema.refine((value) => value.length > 0),
  projectId: projectIdSchema,
}).strict();

export const gitFileDiffSchema = z.object({
  content: z.string().max(2_000_000),
  path: relativeProjectPathSchema.refine((value) => value.length > 0),
  truncated: z.boolean(),
}).strict();

const gitBranchNameSchema = z.string().trim().min(1).max(512);
const gitSelectedPathsSchema = z.array(
  relativeProjectPathSchema.refine((value) => value.length > 0),
).min(1).max(20_000).refine(
  (paths) => new Set(paths).size === paths.length,
  "Selected Git paths must be unique.",
);

export const gitOperationInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stageAll"), projectId: projectIdSchema }).strict(),
  z.object({ action: z.literal("unstageAll"), projectId: projectIdSchema }).strict(),
  z.object({
    action: z.literal("untrackFiles"),
    paths: gitSelectedPathsSchema,
    projectId: projectIdSchema,
  }).strict(),
  z.object({
    action: z.literal("stageFiles"),
    paths: gitSelectedPathsSchema,
    projectId: projectIdSchema,
  }).strict(),
  z.object({
    action: z.literal("stageFile"),
    path: relativeProjectPathSchema.refine((value) => value.length > 0),
    projectId: projectIdSchema,
  }).strict(),
  z.object({
    action: z.literal("unstageFile"),
    path: relativeProjectPathSchema.refine((value) => value.length > 0),
    projectId: projectIdSchema,
  }).strict(),
  z.object({
    action: z.literal("switchBranch"),
    branch: gitBranchNameSchema,
    projectId: projectIdSchema,
  }).strict(),
  z.object({
    action: z.literal("createBranch"),
    branch: gitBranchNameSchema,
    projectId: projectIdSchema,
    startPoint: gitBranchNameSchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("commit"),
    message: z.string().trim().min(1).max(10_000),
    paths: gitSelectedPathsSchema,
    projectId: projectIdSchema,
  }).strict(),
  z.object({ action: z.literal("pull"), projectId: projectIdSchema }).strict(),
  z.object({ action: z.literal("push"), projectId: projectIdSchema }).strict(),
]);

export const terminalSessionOpenInputSchema = z.object({
  columns: z.number().int().min(2).max(500),
  projectId: projectIdSchema,
  rows: z.number().int().min(1).max(300),
}).strict();

export const terminalSessionSchema = z.object({
  projectId: projectIdSchema,
  sessionId: sessionIdSchema,
  shellLabel: z.string().min(1).max(120),
}).strict();

export const terminalSessionWriteInputSchema = z.object({
  data: z.string().max(65_536),
  sessionId: sessionIdSchema,
}).strict();

export const terminalSessionResizeInputSchema = z.object({
  columns: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
  sessionId: sessionIdSchema,
}).strict();

export const terminalSessionReferenceInputSchema = z.object({
  sessionId: sessionIdSchema,
}).strict();

/** A bounded transcript window from one still-running interactive terminal session. */
export const terminalSessionOutputInputSchema = z.object({
  afterCursor: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1).max(65_536).default(32_768),
  sessionId: sessionIdSchema,
}).strict();

export const terminalSessionOutputSchema = z.object({
  data: z.string().max(65_536),
  nextCursor: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

const terminalTabNameSchema = z.string().trim().min(1).max(120);

/** Main asks the Renderer to add a terminal tab for an Agent tool call. */
export const workspaceTerminalTabOpenRequestSchema = z.object({
  conversationId: conversationIdSchema,
  projectId: projectIdSchema,
  requestedName: terminalTabNameSchema.nullable(),
  requestId: sessionIdSchema,
  session: terminalSessionSchema,
}).strict();

/** Renderer acknowledgement carrying the exact de-duplicated tab label. */
export const workspaceTerminalTabOpenedInputSchema = z.object({
  requestId: sessionIdSchema,
  resolvedName: terminalTabNameSchema,
}).strict();

export const terminalSessionEventSchema = z.discriminatedUnion("type", [
  z.object({
    data: z.string().max(262_144),
    sessionId: sessionIdSchema,
    type: z.literal("data"),
  }).strict(),
  z.object({
    exitCode: z.number().int().nullable(),
    sessionId: sessionIdSchema,
    type: z.literal("exit"),
  }).strict(),
]);

export const managedBrowserOpenInputSchema = z.object({
  url: z.string().trim().min(1).max(8_192).optional(),
}).strict();

export const managedBrowserSessionSchema = z.object({
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
  sessionId: sessionIdSchema,
  title: z.string().max(1_024),
  url: z.string().max(8_192),
  zoomPercent: z.number().int().min(25).max(500),
}).strict();

export const managedBrowserNavigateInputSchema = z.object({
  sessionId: sessionIdSchema,
  url: z.string().trim().min(1).max(8_192),
}).strict();

export const managedBrowserWorkspaceAddActionSchema = z.enum([
  "createSideChat",
  "openBrowser",
  "openFiles",
  "openGitReview",
  "openTerminal",
]);

export const managedBrowserWorkspaceTabActionSchema = z.enum([
  "close",
  "closeAll",
  "closeOthers",
]);

const managedBrowserMenuCoordinateSchema = z.number().int().min(0).max(16_384);

export const managedBrowserCommandInputSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.enum([
      "back",
      "clearBrowsingData",
      "forward",
      "openDevTools",
      "print",
      "reload",
      "resetZoom",
      "stop",
      "zoomIn",
      "zoomOut",
    ]),
    sessionId: sessionIdSchema,
  }).strict(),
  z.object({
    command: z.enum(["showDownloads", "showMenu"]),
    sessionId: sessionIdSchema,
    x: managedBrowserMenuCoordinateSchema,
    y: managedBrowserMenuCoordinateSchema,
  }).strict(),
  z.object({
    colorScheme: z.enum(["light", "dark"]),
    command: z.literal("setColorScheme"),
    sessionId: sessionIdSchema,
  }).strict(),
  z.object({
    canCreateSideChat: z.boolean(),
    canOpenGitReview: z.boolean(),
    canOpenTerminal: z.boolean(),
    command: z.literal("showWorkspaceAddMenu"),
    sessionId: sessionIdSchema,
    x: managedBrowserMenuCoordinateSchema,
    y: managedBrowserMenuCoordinateSchema,
  }).strict(),
  z.object({
    canCloseOthers: z.boolean(),
    command: z.literal("showWorkspaceTabMenu"),
    sessionId: sessionIdSchema,
    x: managedBrowserMenuCoordinateSchema,
    y: managedBrowserMenuCoordinateSchema,
  }).strict(),
]);

export const managedBrowserBoundsInputSchema = z.object({
  height: z.number().int().min(0).max(16_384),
  sessionId: sessionIdSchema,
  visible: z.boolean(),
  width: z.number().int().min(0).max(16_384),
  x: z.number().int().min(0).max(16_384),
  y: z.number().int().min(0).max(16_384),
}).strict();

export const managedBrowserReferenceInputSchema = z.object({
  sessionId: sessionIdSchema,
}).strict();

export const managedBrowserSnapshotSchema = z.object({
  data: z.string().min(1).max(32_000_000),
  height: z.number().int().positive().max(16_384),
  mimeType: z.literal("image/jpeg"),
  width: z.number().int().positive().max(16_384),
}).strict();

/** Main asks the Renderer to attach an Agent browser session to a visible workspace tab. */
export const workspaceBrowserTabOpenRequestSchema = z.object({
  conversationId: conversationIdSchema,
  projectId: projectIdSchema,
  requestedName: terminalTabNameSchema.nullable(),
  requestId: sessionIdSchema,
  session: managedBrowserSessionSchema,
}).strict();

export const workspaceBrowserTabOpenedInputSchema = z.object({
  requestId: sessionIdSchema,
  resolvedName: terminalTabNameSchema,
}).strict();

export const workspaceBrowserTabCloseRequestSchema = z.object({
  conversationId: conversationIdSchema,
  sessionId: sessionIdSchema,
}).strict();

export const managedBrowserEventSchema = z.discriminatedUnion("type", [
  z.object({
    session: managedBrowserSessionSchema,
    type: z.literal("state"),
  }).strict(),
  z.object({
    message: z.string().min(1).max(2_000),
    sessionId: sessionIdSchema,
    type: z.literal("error"),
  }).strict(),
  z.object({
    sessionId: sessionIdSchema,
    type: z.literal("openSettings"),
  }).strict(),
  z.object({
    action: managedBrowserWorkspaceAddActionSchema,
    sessionId: sessionIdSchema,
    type: z.literal("workspaceAddMenu"),
  }).strict(),
  z.object({
    action: managedBrowserWorkspaceTabActionSchema,
    sessionId: sessionIdSchema,
    type: z.literal("workspaceTabMenu"),
  }).strict(),
]);

export type GitReviewInput = z.infer<typeof gitReviewInputSchema>;
export type GitReviewSnapshot = z.infer<typeof gitReviewSnapshotSchema>;
export type GitWorkingTreeChange = z.infer<typeof gitWorkingTreeChangeSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitFileDiff = z.infer<typeof gitFileDiffSchema>;
export type GitFileDiffInput = z.infer<typeof gitFileDiffInputSchema>;
export type GitOperationInput = z.infer<typeof gitOperationInputSchema>;
export type ManagedBrowserBoundsInput = z.infer<typeof managedBrowserBoundsInputSchema>;
export type ManagedBrowserCommandInput = z.infer<typeof managedBrowserCommandInputSchema>;
export type ManagedBrowserEvent = z.infer<typeof managedBrowserEventSchema>;
export type ManagedBrowserNavigateInput = z.infer<typeof managedBrowserNavigateInputSchema>;
export type ManagedBrowserOpenInput = z.infer<typeof managedBrowserOpenInputSchema>;
export type ManagedBrowserReferenceInput = z.infer<typeof managedBrowserReferenceInputSchema>;
export type ManagedBrowserSession = z.infer<typeof managedBrowserSessionSchema>;
export type ManagedBrowserSnapshot = z.infer<typeof managedBrowserSnapshotSchema>;
export type ManagedBrowserWorkspaceAddAction = z.infer<typeof managedBrowserWorkspaceAddActionSchema>;
export type ManagedBrowserWorkspaceTabAction = z.infer<typeof managedBrowserWorkspaceTabActionSchema>;
export type TerminalSession = z.infer<typeof terminalSessionSchema>;
export type TerminalSessionEvent = z.infer<typeof terminalSessionEventSchema>;
export type TerminalSessionOpenInput = z.infer<typeof terminalSessionOpenInputSchema>;
export type TerminalSessionOutput = z.infer<typeof terminalSessionOutputSchema>;
export type TerminalSessionOutputInput = z.infer<typeof terminalSessionOutputInputSchema>;
export type TerminalSessionReferenceInput = z.infer<typeof terminalSessionReferenceInputSchema>;
export type TerminalSessionResizeInput = z.infer<typeof terminalSessionResizeInputSchema>;
export type TerminalSessionWriteInput = z.infer<typeof terminalSessionWriteInputSchema>;
export type WorkspaceTerminalTabOpenRequest = z.infer<typeof workspaceTerminalTabOpenRequestSchema>;
export type WorkspaceTerminalTabOpenedInput = z.infer<typeof workspaceTerminalTabOpenedInputSchema>;
export type WorkspaceBrowserTabOpenRequest = z.infer<typeof workspaceBrowserTabOpenRequestSchema>;
export type WorkspaceBrowserTabOpenedInput = z.infer<typeof workspaceBrowserTabOpenedInputSchema>;
export type WorkspaceBrowserTabCloseRequest = z.infer<typeof workspaceBrowserTabCloseRequestSchema>;
