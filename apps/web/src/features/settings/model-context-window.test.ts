import { describe, expect, it } from "vitest";
import { formatModelContextWindow, parseModelContextWindow } from "./model-context-window.js";

describe("model context window input", () => {
  it.each([
    ["", 0], ["128000", 128000], ["128K", 128000], ["128k", 128000],
    ["1.5M", 1500000], ["1.5m", 1500000], [".5K", 500], [" 200.5 k ", 200500],
    ["1.0005K", 1001], ["10M", 10000000],
  ])("parses %s as %s Tokens", (value, expected) => {
    expect(parseModelContextWindow(value)).toBe(expected);
  });

  it.each(["K", "1.5.2M", "-1", "Infinity", "1e6", "11M", "128KB"])("rejects invalid input %s", value => {
    expect(parseModelContextWindow(value)).toBeNull();
  });

  it.each([0, 500, 128000, 200500, 1000000, 1500000, 1048576, 10000000])("preserves %s Tokens when formatting for edit", tokens => {
    expect(parseModelContextWindow(formatModelContextWindow(tokens))).toBe(tokens);
  });
});
