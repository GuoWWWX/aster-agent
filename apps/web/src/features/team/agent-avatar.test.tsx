import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_AVATAR_PRESETS } from "@agent/protocol";
import { AGENT_AVATAR_PRESET_OPTIONS } from "./agent-character-avatar.js";

import {
  AGENT_AVATAR_ICON_OPTIONS,
  AgentAvatar,
  SubagentAvatar,
  createSubagentIdenticon,
} from "./agent-avatar.js";

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

  it("renders a built-in character at compact size without an external image", () => {
    const markup = renderToStaticMarkup(<AgentAvatar avatar={{ kind: "preset", preset: "fox" }} size="compact" />);
    expect(markup).toContain('data-avatar-preset="fox"');
    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 64 64"');
    expect(markup).not.toContain('<img');
  });

  it("provides an illustration and localized name for every saved character preset", () => {
    expect(AGENT_AVATAR_PRESET_OPTIONS.map(option => option.id)).toEqual(AGENT_AVATAR_PRESETS);
    for (const preset of AGENT_AVATAR_PRESETS) {
      const markup = renderToStaticMarkup(<AgentAvatar avatar={{ kind: "preset", preset }} />);
      expect(markup).toContain('<svg'); expect(markup).not.toContain('<animate');
    }
  });

  it("creates a stable symmetric pixel identity from the conversation ID", () => {
    const first = createSubagentIdenticon("conversation-a");
    const repeated = createSubagentIdenticon("conversation-a");
    const different = createSubagentIdenticon("conversation-b");

    expect(repeated).toEqual(first);
    expect(different).not.toEqual(first);
    expect(first.cells.length).toBeGreaterThan(0);
    for (const cell of first.cells) {
      expect(first.cells).toContainEqual({ x: 4 - cell.x, y: cell.y });
    }
  });

  it("renders a generated avatar only when no configured icon is available", () => {
    const generated = renderToStaticMarkup(
      <SubagentAvatar icon={null} seed="conversation-a" size="compact" />,
    );
    const configured = renderToStaticMarkup(
      <SubagentAvatar icon="bug" seed="conversation-a" size="compact" />,
    );

    expect(generated).toContain("data-subagent-avatar=\"generated\"");
    expect(generated).toContain("shape-rendering=\"crispEdges\"");
    expect(configured).toContain("data-tone=\"rose\"");
    expect(configured).not.toContain("data-subagent-avatar=\"generated\"");
  });
});
