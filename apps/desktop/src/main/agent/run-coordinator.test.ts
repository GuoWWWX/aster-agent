import { describe, expect, it } from "vitest";

import { RunCoordinator } from "./run-coordinator.js";

describe("RunCoordinator", () => {
  it("registers, cancels, waits for, and completes one active Run", async () => {
    const coordinator = new RunCoordinator();
    const controller = new AbortController();
    const active = coordinator.register("run-1", controller);

    coordinator.cancel("run-1");
    expect(controller.signal.aborted).toBe(true);
    expect(coordinator.get("run-1")).toBe(active);

    const finished = active.finished;
    expect(coordinator.complete("run-1")).toEqual({ activeRun: active, wasReplacing: false });
    await expect(finished).resolves.toBeUndefined();
    expect(coordinator.get("run-1")).toBeUndefined();
  });

  it("refuses duplicate registration", () => {
    const coordinator = new RunCoordinator();
    coordinator.register("run-1", new AbortController());

    expect(() => coordinator.register("run-1", new AbortController()))
      .toThrow("already registered");
  });

  it("schedules execution after registering the active Run", async () => {
    const coordinator = new RunCoordinator();
    let observedActive = false;
    const active = coordinator.schedule("run-1", "conversation-1", () => {
      observedActive = coordinator.get("run-1") !== undefined;
      coordinator.complete("run-1");
      return Promise.resolve();
    });

    await active.finished;
    expect(observedActive).toBe(true);
  });

  it("records replacement so a completed Run can suppress automatic follow-up", () => {
    const coordinator = new RunCoordinator();
    coordinator.register("run-1", new AbortController());
    coordinator.markReplacing("run-1");

    expect(coordinator.complete("run-1").wasReplacing).toBe(true);
  });

  it("enforces one in-memory active Run per Conversation", () => {
    const coordinator = new RunCoordinator();
    const first = coordinator.register("run-1", new AbortController(), "conversation-1");

    expect(coordinator.getActiveForConversation("conversation-1")).toBe(first);
    expect(() => coordinator.register("run-2", new AbortController(), "conversation-1"))
      .toThrow("Conversation already has an active Run");

    coordinator.complete("run-1");
    expect(coordinator.getActiveForConversation("conversation-1")).toBeUndefined();
    expect(() => coordinator.register("run-2", new AbortController(), "conversation-1")).not.toThrow();
  });
});
