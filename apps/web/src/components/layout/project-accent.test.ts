import { describe, expect, it } from "vitest";
import { projectAccent } from "./project-accent.js";
describe("project titlebar accent", () => {
  it("is stable across reloads and leaves projectless pages neutral", () => {
    expect(projectAccent(null)).toBeNull();
    expect(projectAccent({ id: "aster-project" })).toEqual(projectAccent({ id: "aster-project" }));
    const palettes = new Set(Array.from({ length: 30 }, (_, id) => JSON.stringify(projectAccent({ id: String(id) }))));
    expect(palettes.size).toBeGreaterThan(3);
  });
});
