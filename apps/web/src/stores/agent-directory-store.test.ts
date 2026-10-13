import { afterEach, describe, expect, it } from "vitest";
import { agentDirectoryConfigurationSchema } from "@agent/protocol";
import { useAgentDirectoryStore } from "./agent-directory-store.js";

const initial = useAgentDirectoryStore.getState();
afterEach(() => useAgentDirectoryStore.setState(initial));

describe("agent directory deletion", () => {
  it("removes an Agent from teams and replaces a deleted lead", () => {
    const store = useAgentDirectoryStore.getState();
    const id = store.addAgent();
    const teamId = store.addTeam();
    store.updateTeam(teamId, { leadAgentId: id, memberIds: [id], memberConfigurations: { [id]: { instructions: "extra", role: "lead" } } });
    store.removeAgent(id);
    const state = useAgentDirectoryStore.getState();
    expect(state.agents.some((agent) => agent.id === id)).toBe(false);
    expect(state.teams.find((team) => team.id === teamId)).toMatchObject({ memberConfigurations: {}, memberIds: [state.agents.find((agent) => agent.isDefault)!.id] });
    expect(() => agentDirectoryConfigurationSchema.parse({ agents: state.agents, teams: state.teams })).not.toThrow();
  });

  it("protects the default Agent and removes a team", () => {
    const store = useAgentDirectoryStore.getState();
    const defaultAgent = store.agents.find((agent) => agent.isDefault)!;
    store.removeAgent(defaultAgent.id);
    expect(useAgentDirectoryStore.getState().agents.some((agent) => agent.id === defaultAgent.id)).toBe(true);
    const id = store.addTeam();
    store.removeTeam(id);
    expect(useAgentDirectoryStore.getState().teams.some((team) => team.id === id)).toBe(false);
  });
});
