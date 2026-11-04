import { describe, expect, it } from "vitest";
import { projectAccent } from "./project-accent.js";
describe("project titlebar accent", () => {
  it("is stable across reloads and leaves projectless pages neutral", () => {
    expect(projectAccent(null)).toBeNull();
    expect(projectAccent({ id: "aster-project" })).toEqual(projectAccent({ id: "aster-project" }));
    const palettes = new Set(Array.from({ length: 30 }, (_, id) => JSON.stringify(projectAccent({ id: String(id) }))));
    expect(palettes.size).toBeGreaterThan(3);
  });
  it("gives sixteen projects distinct bases and keeps colors when navigation order or names change", () => {
    const projects = Array.from({ length: 16 }, (_, index) => ({ id: `project-${String(index).padStart(2, "0")}`, name: `项目 ${index}` }));
    const accents = projects.map((project) => projectAccent(project, projects));
    expect(new Set(accents.map((accent) => JSON.stringify(accent))).size).toBe(16);
    for (const [index, project] of projects.entries()) {
      const renamed = { ...project, name: "重命名" };
      expect(projectAccent(renamed, [...projects].reverse())).toEqual(accents[index]);
    }
    // Even colliding hashes in a small project set use the five separated primary bases.
    const small = projects.slice(0, 5).map((project) => projectAccent(project, projects.slice(0, 5))?.[0]);
    expect(new Set(small)).toEqual(new Set(["#df676d", "#c8bb57", "#6095e1", "#62b181", "#ca77b2"]));
  });
  it("uses bounded blends only after the fixed bases are exhausted", () => {
    const projects = Array.from({ length: 48 }, (_, index) => ({ id: `project-${String(index).padStart(2, "0")}` }));
    const accents = projects.map((project) => projectAccent(project, projects));
    expect(accents.slice(0, 16).every((accent) => accent?.[0].startsWith("#"))).toBe(true);
    expect(accents.slice(16).every((accent) => accent?.[0].startsWith("color-mix("))).toBe(true);
    expect(new Set(accents.map((accent) => JSON.stringify(accent))).size).toBe(48);
    expect(projectAccent(null, projects)).toBeNull();
  });
});
