import type { ConversationToolItem } from "@agent/protocol";
import type { ReactElement } from "react";
import type { AgentClient } from "../../runtime/index.js";
import { BrowserScreenshotResult } from "./browser-screenshot-result.js";
import { GeneratedImagesResult } from "./generated-images-result.js";
import { ImagePreviewStrip } from "./image-preview-strip.js";
import { ProjectImageResult } from "./project-image-result.js";
import {
  AgentConversationListResult,
  AgentConversationReadResult,
  AgentMessageToolResult,
  SubagentToolResult,
} from "./collaboration-tool-result.js";
import {
  parseAgentConversationListResult,
  parseAgentConversationReadResult,
  parseAgentMessageToolResult,
  parseSubagentToolResult,
} from "./collaboration-tool-result-model.js";
import { CommandLifecycleResult, CommandTerminal } from "./command-tool-result.js";
import { parseCommandLifecycleResult, type LiveToolOutput } from "./command-tool-result-model.js";
import { FileChangeResult } from "./file-change-result.js";
import { toolActivityLabel } from "./tool-activity-presentation.js";
import { StructuredToolResult, ToolResultNotice } from "./tool-result-content.js";
import { isRecord, parseToolError, parseToolPayload } from "./tool-result-payload.js";
import {
  ProjectOperationResult,
  ProjectInfoResult,
  DirectoryListingResult,
  FileReadResult,
  AttachmentReadResult,
  AttachmentViewResult,
  SearchTextResult,
  WebSearchResult,
  FindFilesResult,
} from "./workspace-tool-result.js";
import {
  parseBrowserScreenshot,
  parseProjectOperationResult,
  parseProjectInfoResult,
  parseDirectoryListingResult,
  parseAttachmentReadResult,
  parseAttachmentViewResult,
  parseSearchTextResult,
  parseWebSearchResult,
  parseFindFilesResult,
} from "./workspace-tool-result-model.js";

export function ToolDetail({
  agentClient,
  item,
  teamManaged,
  liveOutput,
  onOpenSubagent,
  onOpenProjectFile,
}: {
  agentClient: AgentClient;
  item: ConversationToolItem;
  teamManaged: boolean;
  liveOutput?: LiveToolOutput;
  onOpenSubagent: ((conversationId: string) => void) | undefined;
  onOpenProjectFile: ((path: string) => void) | undefined;
}): ReactElement {
  if (item.name === "generate_images") return <div className="ml-5 min-w-0 py-[5px]">
    <GeneratedImagesResult agentClient={agentClient} item={item} placement="tool" />
  </div>;
  if (item.name === "load_skill") return <StructuredToolResult summary={toolActivityLabel(item)}>
    {item.status === "failed" ? <ToolResultNotice result={item.result} status={item.status} /> : <p className="m-0">{item.status === "completed" ? "技能使用说明已载入本轮对话。" : "正在读取技能使用说明。"}</p>}
  </StructuredToolResult>;
  const screenshot = ["browser_control", "computer_use", "present_html"].includes(item.name) && item.result !== null ? parseBrowserScreenshot(item.result) : null;
  if (screenshot !== null) return <ImagePreviewStrip>
    {screenshot.images.map(image => <BrowserScreenshotResult key={image.id} agentClient={agentClient} image={image} />)}
  </ImagePreviewStrip>;
  if (item.name === "request_user_input") {
    const questions: unknown = parseToolPayload(item.arguments)?.questions;
    const prompts: unknown[] = Array.isArray(questions) ? questions : [];
    return <div className="ml-5 flex min-w-0 flex-col gap-[5px] py-[5px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">
      {prompts.map((question, index) =>
        typeof question === "object" && question !== null && "question" in question && typeof question.question === "string"
          ? <p key={index} className="m-0 break-words">{question.question}</p> : null)}
      {item.status === "failed" ? <ToolResultNotice result={item.result} status={item.status} /> : null}
    </div>;
  }
  if (item.name === "run_command") {
    return (
      <CommandTerminal
        writeClipboardText={(text) => agentClient.writeClipboardText(text)}
        argumentsPayload={item.arguments}
        createdAt={item.createdAt}
        resultPayload={item.result}
        status={item.status}
        {...(liveOutput === undefined ? {} : { liveOutput })}
      />
    );
  }

  if (item.name === "wait_for_commands" || item.name === "stop_command") {
    return (
      <CommandLifecycleResult
        writeClipboardText={(text) => agentClient.writeClipboardText(text)}
        mode={item.name === "wait_for_commands" ? "wait" : "stop"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (item.name === "list_project_operations" || item.name === "wait_for_project_operation") {
    return (
      <ProjectOperationResult
        mode={item.name === "list_project_operations" ? "list" : "wait"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (item.name === "get_project_info") {
    return <ProjectInfoResult payload={item.result} status={item.status} />;
  }

  if (item.name === "list_directory") {
    return <DirectoryListingResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_file") {
    return <FileReadResult argumentsPayload={item.arguments} payload={item.result} status={item.status} />;
  }

  if (item.name === "read_external_file") {
    return <FileReadResult argumentsPayload={item.arguments} payload={item.result} status={item.status} />;
  }

  if (item.name === "read_attachment") {
    return <AttachmentReadResult payload={item.result} status={item.status} />;
  }

  if (item.name === "view_attachments") {
    return (
      <AttachmentViewResult
        agentClient={agentClient}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (item.name === "view_image" && item.status === "completed" && item.result !== null) {
    return <ProjectImageResult agentClient={agentClient} payload={item.result} />;
  }

  if (item.name === "search_text") {
    return <SearchTextResult payload={item.result} status={item.status} />;
  }

  if (item.name === "web_search") {
    return <WebSearchResult payload={item.result} status={item.status} />;
  }

  if (item.name === "find_files") {
    return <FindFilesResult payload={item.result} status={item.status} />;
  }

  if (item.name === "list_agent_conversations") {
    return <AgentConversationListResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_agent_conversation") {
    return <AgentConversationReadResult item={item} payload={item.result} status={item.status} />;
  }

  if (item.name === "send_agent_message" || item.name === "wait_for_agent_message") {
    return (
      <AgentMessageToolResult
        item={item}
        mode={item.name === "send_agent_message" ? "sent" : "received"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (
    item.name === "spawn_subagent"
    || item.name === "list_subagents"
    || item.name === "wait_for_subagents"
  ) {
    return (
      <SubagentToolResult
        onOpenSubagent={onOpenSubagent}
        payload={item.result}
        status={item.status}
        teamManaged={teamManaged}
      />
    );
  }

  if (
    item.name === "write_file" ||
    item.name === "replace_in_file" ||
    item.name === "apply_patch" ||
    item.name === "delete_file"
  ) {
    return (
      <FileChangeResult
        diff={item.diff}
        onOpenProjectFile={onOpenProjectFile}
        result={item.result}
        toolName={item.name}
      />
    );
  }

  return <ToolResultNotice result={item.result} status={item.status} />;
}

export function toolHasDisplayableDetails(item: ConversationToolItem): boolean {
  if (item.status === "failed" || item.status === "awaiting_approval" || item.diff !== null
    || (item.result !== null && parseToolError(item.result) !== null)) return true;
  if (item.name === "run_command" || item.name === "generate_images" || item.name === "load_skill") return true;
  // File reads display their requested path and line range even before a result arrives.
  if (item.name === "read_file" || item.name === "read_external_file") return true;
  if (item.name === "request_user_input") {
    const questions = parseToolPayload(item.arguments)?.questions;
    return Array.isArray(questions) && questions.some((question: unknown) => isRecord(question)
      && typeof question.question === "string" && question.question.trim().length > 0);
  }
  const payload = item.result;
  if (payload === null) return false;
  switch (item.name) {
    case "wait_for_commands": return parseCommandLifecycleResult(payload, "wait") !== null;
    case "stop_command": return parseCommandLifecycleResult(payload, "stop") !== null;
    case "list_project_operations": return parseProjectOperationResult(payload, "list") !== null;
    case "wait_for_project_operation": return parseProjectOperationResult(payload, "wait") !== null;
    case "get_project_info": return parseProjectInfoResult(payload) !== null;
    case "list_directory": return parseDirectoryListingResult(payload) !== null;
    case "read_attachment": return parseAttachmentReadResult(payload) !== null;
    case "view_attachments": return parseAttachmentViewResult(payload) !== null;
    case "view_image": return item.status === "completed";
    case "search_text": return parseSearchTextResult(payload) !== null;
    case "web_search": return parseWebSearchResult(payload) !== null;
    case "find_files": return parseFindFilesResult(payload) !== null;
    case "list_agent_conversations": return parseAgentConversationListResult(payload) !== null;
    case "read_agent_conversation": return parseAgentConversationReadResult(payload) !== null;
    case "send_agent_message":
    case "wait_for_agent_message": return parseAgentMessageToolResult(payload) !== null;
    case "spawn_subagent":
    case "list_subagents":
    case "wait_for_subagents": return parseSubagentToolResult(payload) !== null;
    case "computer_use":
    case "present_html":
    case "browser_control": return parseBrowserScreenshot(payload) !== null;
    default: return false;
  }
}
