import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AGENT_AVATAR_ICON_OPTIONS, AgentAvatar } from "./agent-avatar.js";

describe("AgentAvatar", () => {
  it("offers a distinct shared icon catalog", () => {
    expect(AGENT_AVATAR_ICON_OPTIONS).toHaveLength(63);
    expect(new Set(AGENT_AVATAR_ICON_OPTIONS.map((option) => option.id)).size).toBe(63);
    expect(new Set(AGENT_AVATAR_ICON_OPTIONS.map((option) => option.tone)).size).toBeGreaterThan(4);
  });

  it("renders a themeable SVG icon with its visual tone", () => {
    const markup = renderToStaticMarkup(
      <AgentAvatar avatar={{ icon: "bug", kind: "icon" }} size="compact" />,
    );

    expect(markup).toContain("data-tone=\"rose\"");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("data:image");
  });
});
