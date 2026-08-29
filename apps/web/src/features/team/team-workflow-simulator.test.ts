import { describe, expect, it } from "vitest";

import { TEAM_WORKFLOW_EXAMPLES } from "./team-workflow-examples.js";
import {
  createWorkflowSimulation,
  advanceWorkflowSimulation,
  runWorkflowToCompletion,
} from "./team-workflow-simulator.js";

describe("team workflow simulator", () => {
  it.each(TEAM_WORKFLOW_EXAMPLES.map((workflow) => [workflow.name, workflow] as const))(
    "runs %s to a deterministic delivery",
    (_name, workflow) => {
      const result = runWorkflowToCompletion(workflow, "实现团队工作流");

      expect(result.status).toBe("completed");
      expect(result.activeNodeIds).toEqual([]);
      expect(result.stages).toHaveLength(workflow.nodes.length);
      expect(result.stages.every((stage) => stage.status === "completed")).toBe(true);
      expect(result.stages.at(-1)?.output).toContain("交付包");
      expect(result.events.at(-1)?.type).toBe("workflow_completed");
    },
  );

  it("expands a temporary developer for the standard workflow", () => {
    const workflow = findWorkflow("standard-development");
    const result = runWorkflowToCompletion(workflow);

    expect(result.temporaryAgentCount).toBe(1);
    expect(result.events).toContainEqual(expect.objectContaining({
      nodeId: "development",
      type: "capacity_expanded",
    }));
  });

  it("waits for a busy tester before resuming the hotfix workflow", () => {
    const workflow = findWorkflow("hotfix");
    let state = createWorkflowSimulation(workflow);
    while (state.stages.find((stage) => stage.nodeId === "regression")?.status === "queued") {
      state = advanceWorkflowSimulation(workflow, state);
    }

    expect(state.stages.find((stage) => stage.nodeId === "regression")).toMatchObject({
      assignedAgents: [],
      status: "waiting",
    });
    const resumed = advanceWorkflowSimulation(workflow, state);
    expect(resumed.stages.find((stage) => stage.nodeId === "regression")).toMatchObject({
      assignedAgents: ["测试 Agent"],
      status: "running",
    });
  });

  it("runs parallel branches before activating their merge node", () => {
    const workflow = findWorkflow("large-feature");
    let state = createWorkflowSimulation(workflow);
    while (!state.activeNodeIds.includes("frontend-development")) {
      state = advanceWorkflowSimulation(workflow, state);
    }

    expect(state.activeNodeIds).toEqual(expect.arrayContaining([
      "frontend-development",
      "backend-development",
      "test-fixtures",
    ]));
    expect(state.stages.find((stage) => stage.nodeId === "integration")?.status).toBe("queued");

    state = advanceWorkflowSimulation(workflow, state);
    expect(state.stages.find((stage) => stage.nodeId === "integration")?.status).toBe("waiting");
    expect(state.stages.find((stage) => stage.nodeId === "integration")?.input).toContain("前端开发");
    expect(state.stages.find((stage) => stage.nodeId === "integration")?.input).toContain("后端开发");
    expect(state.stages.find((stage) => stage.nodeId === "integration")?.input).toContain("测试夹具");
  });
});

function findWorkflow(id: string): (typeof TEAM_WORKFLOW_EXAMPLES)[number] {
  const workflow = TEAM_WORKFLOW_EXAMPLES.find((candidate) => candidate.id === id);
  if (workflow === undefined) throw new Error(`Missing workflow fixture: ${id}`);
  return workflow;
}
