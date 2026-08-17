import { describe, expect, it } from "vitest";

import { parseToolArguments } from "./tool-arguments.js";

describe("parseToolArguments", () => {
  it.each(["", "   ", "{}"]) ("normalizes %j to an empty object", (value) => {
    expect(parseToolArguments(value)).toEqual({});
  });

  it("parses only JSON objects", () => {
    expect(parseToolArguments('{"path":"src"}')).toEqual({ path: "src" });
    expect(() => parseToolArguments("[]")).toThrow(/JSON object/i);
    expect(() => parseToolArguments("true")).toThrow(/JSON object/i);
    expect(() => parseToolArguments("broken")).toThrow(/valid JSON/i);
  });
});
