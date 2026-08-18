import { describe, expect, it } from "vitest";

import { parseToolArguments, ToolArgumentsError } from "./tool-arguments.js";

describe("parseToolArguments", () => {
  it.each(["", "   ", "{}"]) ("normalizes %j to an empty object", (value) => {
    expect(parseToolArguments(value)).toEqual({});
  });

  it("parses only JSON objects", () => {
    expect(parseToolArguments('{"path":"src"}')).toEqual({ path: "src" });
    expect(() => parseToolArguments("[]")).toThrow(ToolArgumentsError);
    expect(() => parseToolArguments("true")).toThrow(ToolArgumentsError);
    expect(() => parseToolArguments("broken")).toThrow(ToolArgumentsError);
  });

  it("exposes stable issue codes for malformed provider arguments", () => {
    const cases: ReadonlyArray<{
      issue: { code: string; message: string };
      value: string;
    }> = [
      { value: "broken", issue: { code: "invalid_json", message: "Tool arguments must be valid JSON." } },
      { value: "[]", issue: { code: "invalid_type", message: "Tool arguments must be a JSON object." } },
    ];
    expect.assertions(cases.length * 3);
    for (const testCase of cases) {
      try {
        parseToolArguments(testCase.value);
        throw new Error("Expected tool argument parsing to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(ToolArgumentsError);
        if (!(error instanceof ToolArgumentsError)) continue;
        expect(error.code).toBe("TOOL_ARGUMENTS_INVALID");
        expect(error.issues).toEqual([{ ...testCase.issue, path: [] }]);
      }
    }
  });
});
