import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AgentCommunicationTool } from "../agent/agent-communication-tool.js";
import { SubagentTool } from "../agent/subagent-tool.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters } from "../model/tool-arguments.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { TaskListTool } from "../tasks/task-list-tool.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "./project-tool-registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function definition(
  definitions: readonly ModelToolDefinition[],
  name: string,
): ModelToolDefinition {
  const result = definitions.find((candidate) => candidate.name === name);
  if (result === undefined) throw new Error(`Missing tool definition: ${name}`);
  return result;
}

function property(
  definitions: readonly ModelToolDefinition[],
  toolName: string,
  propertyName: string,
): Record<string, unknown> {
  const properties = definition(definitions, toolName).parameters.properties;
  if (!isRecord(properties) || !isRecord(properties[propertyName])) {
    throw new Error(`Missing ${toolName}.${propertyName} parameter definition.`);
  }
  return properties[propertyName];
}

describe("model tool definitions", () => {
  it("generates provider-neutral input JSON Schema from the execution schema", () => {
    const parameters = modelToolParameters(z.object({
      id: z.string().uuid(),
      limit: z.number().int().min(1).default(20),
    }).strict());

    expect(parameters).not.toHaveProperty("$schema");
    expect(parameters).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { format: "uuid", type: "string" },
        limit: { default: 20, minimum: 1, type: "integer" },
      },
      required: ["id"],
      type: "object",
    });
  });

  it("exposes the same UUID shape accepted by tool validators", () => {
    const database = new AgentDatabase(":memory:");
    const definitions = [
      ...new AgentCommunicationTool(database).getDefinitions(),
      ...new SubagentTool(database).getDefinitions(),
      ...new ProjectToolRegistry(new ProjectRegistry()).getDefinitions(),
    ];

    const uuidParameters: Array<[string, string]> = [
      ["read_agent_conversation", "conversationId"],
      ["send_agent_message", "conversationId"],
      ["wait_for_agent_message", "conversationId"],
      ["wait_for_project_operation", "operationId"],
      ["stop_command", "commandId"],
    ];
    for (const [toolName, propertyName] of uuidParameters) {
      expect(property(definitions, toolName, propertyName)).toMatchObject({
        format: "uuid",
        type: "string",
      });
    }

    expect(property(definitions, "wait_for_commands", "commandIds")).toMatchObject({
      items: { format: "uuid", type: "string" },
    });
    expect(property(definitions, "wait_for_subagents", "taskIds")).toMatchObject({
      items: { format: "uuid", type: "string" },
    });
    database.close();
  });

  it("exposes bounded string limits before the model calls a tool", () => {
    const database = new AgentDatabase(":memory:");
    const definitions = [
      ...new AgentCommunicationTool(database).getDefinitions(),
      ...new SubagentTool(database).getDefinitions(),
      ...new TaskListTool(database).getDefinitions(),
      ...new ProjectToolRegistry(new ProjectRegistry()).getDefinitions(),
    ];

    expect(property(definitions, "send_agent_message", "content")).toMatchObject({
      maxLength: 20_000,
    });
    expect(property(definitions, "spawn_subagent", "task")).toMatchObject({
      maxLength: 20_000,
    });
    expect(property(definitions, "spawn_subagent", "name")).toMatchObject({
      maxLength: 80,
    });
    const avatarIcons = property(definitions, "spawn_subagent", "icon").enum;
    if (!Array.isArray(avatarIcons) || !avatarIcons.every((value) => typeof value === "string")) {
      throw new Error("Missing spawn_subagent.icon enum.");
    }
    expect(avatarIcons).toEqual(expect.arrayContaining(["bot", "brain", "bug", "rocket"]));
    expect(property(definitions, "run_command", "command")).toMatchObject({
      maxLength: 4_000,
    });
    expect(property(definitions, "apply_patch", "patch")).toMatchObject({
      maxLength: 200_000,
    });
    const endLineDescription = property(definitions, "read_file", "endLine").description;
    expect(typeof endLineDescription).toBe("string");
    if (typeof endLineDescription !== "string") {
      throw new Error("Missing read_file.endLine description.");
    }
    expect(endLineDescription).toContain("400");

    const taskItems = property(definitions, "create_task_list", "tasks").items;
    if (!isRecord(taskItems) || !isRecord(taskItems.properties)) {
      throw new Error("Missing task item schema.");
    }
    expect(taskItems.properties.title).toMatchObject({ maxLength: 300 });
    database.close();
  });
});
