import { describe, expect, it } from "vitest";
import { agentAvatarSchema } from "./agent-avatar.js";

describe("agent avatars", () => {
  it.each([
    { kind: "icon", icon: "bot" },
    { kind: "image", dataUrl: "data:image/png;base64,fixture", fileName: "my-avatar.png" },
    { kind: "preset", preset: "orbit" },
    { kind: "preset", preset: "fox" },
  ])("round-trips a saved $kind avatar", avatar => {
    expect(agentAvatarSchema.parse(JSON.parse(JSON.stringify(avatar)))).toEqual(avatar);
  });

  it("rejects unknown presets and mixed avatar fields", () => {
    expect(agentAvatarSchema.safeParse({ kind: "preset", preset: "missing" }).success).toBe(false);
    expect(agentAvatarSchema.safeParse({ kind: "preset", preset: "fox", dataUrl: "external" }).success).toBe(false);
  });
});
