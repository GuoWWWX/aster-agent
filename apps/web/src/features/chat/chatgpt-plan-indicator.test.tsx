import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatGptPlanIndicator } from "./chatgpt-plan-indicator.js";

describe("ChatGPT plan indicator", () => {
  it("shows the usage link only for a ChatGPT plan model", () => {
    expect(renderToStaticMarkup(<ChatGptPlanIndicator authentication={undefined} />)).toBe("");
    const html = renderToStaticMarkup(<ChatGptPlanIndicator authentication="chatgpt" />);
    expect(html).toContain("正在使用 ChatGPT 套餐");
    expect(html).toContain('href="https://chatgpt.com/settings/usage"');
  });
});
