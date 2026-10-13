import { describe, expect, it } from "vitest";
import { browserSavedPasswordListSchema, browserPasswordValueSchema } from "./browser.js";
import { browserPasswordReferenceIpcArgumentsSchema } from "./ipc.js";
describe("browser saved password inspection", () => {
  it("lists metadata without accepting a plaintext password", () => {
    const entry = { origin: "https://example.test", username: "sample-user" };
    expect(browserSavedPasswordListSchema.parse([entry])).toEqual([entry]);
    expect(browserSavedPasswordListSchema.safeParse([{ ...entry, password: "sample-secret" }]).success).toBe(false);
  });
  it("validates explicit reveal arguments and missing passwords", () => {
    expect(browserPasswordReferenceIpcArgumentsSchema.parse([{ origin: "https://example.test" }])).toHaveLength(1);
    for (const args of [[], [{ origin: "http://example.test" }], [{ origin: "https://example.test/path" }], [{ origin: "https://example.test" }, "extra"]]) {
      expect(browserPasswordReferenceIpcArgumentsSchema.safeParse(args).success).toBe(false);
    }
    expect(browserPasswordValueSchema.parse(null)).toBeNull();
    expect(browserPasswordValueSchema.safeParse("").success).toBe(false);
  });
});
