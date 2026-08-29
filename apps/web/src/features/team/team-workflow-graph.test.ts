import { describe, expect, it } from "vitest";

import { createWorkflowEdge, wouldCreateWorkflowCycle } from "./team-workflow-graph.js";

describe("team workflow graph", () => {
  const edges = [createWorkflowEdge("plan", "frontend"), createWorkflowEdge("frontend", "merge")];

  it("allows parallel branches and multiple inputs to a merge node", () => {
    expect(wouldCreateWorkflowCycle(edges, "plan", "backend")).toBe(false);
    expect(wouldCreateWorkflowCycle(edges, "backend", "merge")).toBe(false);
  });

  it("rejects self links and links back to an ancestor", () => {
    expect(wouldCreateWorkflowCycle(edges, "plan", "plan")).toBe(true);
    expect(wouldCreateWorkflowCycle(edges, "merge", "plan")).toBe(true);
  });
});
