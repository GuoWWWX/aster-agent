import { describe, expect, it } from "vitest";

import { requestFingerprint } from "./request-fingerprint.js";

describe("requestFingerprint", () => {
  const messages = [{ role: "system", content: "rules" }, { role: "user", content: "private prompt" }];
  const body = { model: "model", messages, tools: [{ type: "function", function: { name: "read" } }] };

  it("keeps stable prefix hashes on append and identifies changed messages, tools, and settings", () => {
    const first = requestFingerprint(JSON.stringify(body));
    const appended = requestFingerprint(JSON.stringify({ ...body, messages: [...messages, { role: "assistant", content: "answer" }] }));
    expect(first).toBeDefined();
    expect(appended?.messageHashes.slice(0, 2)).toEqual(first?.messageHashes);
    expect(appended?.toolsHash).toEqual(first?.toolsHash);
    expect(appended?.settingsHash).toEqual(first?.settingsHash);
    expect(appended?.bodyHash).not.toEqual(first?.bodyHash);
    expect(requestFingerprint(JSON.stringify({ ...body, messages: [{ role: "system", content: "changed" }] }))?.messageHashes[0])
      .not.toEqual(first?.messageHashes[0]);
    expect(requestFingerprint(JSON.stringify({ ...body, tools: [] }))?.toolsHash).not.toEqual(first?.toolsHash);
    expect(requestFingerprint(JSON.stringify({ ...body, reasoning_effort: "high" }))?.settingsHash).not.toEqual(first?.settingsHash);
    expect(requestFingerprint(JSON.stringify({ ...body, prompt_cache_key: "scope-one" }))?.settingsHash).not.toEqual(first?.settingsHash);
    expect(requestFingerprint(JSON.stringify({ ...body, prompt_cache_options: { ttl: "30m" } }))?.settingsHash).not.toEqual(first?.settingsHash);
    expect(JSON.stringify(first)).not.toContain("private prompt");
    expect(JSON.stringify(first)).not.toContain("rules");
  });

  it("bounds diagnostics and skips oversized or non-JSON bodies", () => {
    const result = requestFingerprint(JSON.stringify({ messages: Array.from({ length: 500 }, () => messages[0]) }));
    expect(result?.messageCount).toBe(500);
    expect(result?.messageHashes).toHaveLength(32);
    expect(Object.keys(result?.messagePrefixHashes ?? {})).toHaveLength(28);
    expect(result?.messagePrefixHashes?.["256"]).toBeDefined();
    expect(result?.messagePrefixHashes?.["264"]).toBeUndefined();
    expect(JSON.stringify(result).length).toBeLessThan(4_096);
    expect(requestFingerprint("x".repeat(4 * 1024 * 1024 + 1))).toBeUndefined();
    expect(requestFingerprint("not json")).toBeUndefined();
    expect(requestFingerprint("null")).toBeUndefined();
    expect(requestFingerprint(undefined)).toBeUndefined();
  });

  it("identifies prefix changes beyond the first 32 messages without retaining history", () => {
    const history = Array.from({ length: 132 }, (_, index) => ({ role: "user", content: `private history ${index}` }));
    const first = requestFingerprint(JSON.stringify({ input: history }));
    const appended = requestFingerprint(JSON.stringify({ input: [...history, { role: "user", content: "next request" }] }));
    const changed = requestFingerprint(JSON.stringify({ input: history.map((message, index) => index === 70 ? { ...message, content: "changed" } : message) }));
    expect(first?.messagePrefixHashes?.["128"]).toBeDefined();
    expect(appended?.messagePrefixHashes).toEqual(first?.messagePrefixHashes);
    expect(changed?.messageHashes).toEqual(first?.messageHashes);
    expect(changed?.messagePrefixHashes?.["64"]).toEqual(first?.messagePrefixHashes?.["64"]);
    expect(changed?.messagePrefixHashes?.["72"]).not.toEqual(first?.messagePrefixHashes?.["72"]);
    expect(changed?.messagePrefixHashes?.["128"]).not.toEqual(first?.messagePrefixHashes?.["128"]);
    expect(JSON.stringify(first)).not.toContain("private history");
  });

  it("supports Responses and Anthropic system fields without storing their contents", () => {
    const responses = requestFingerprint(JSON.stringify({ instructions: "private instructions", input: messages }));
    const anthropic = requestFingerprint(JSON.stringify({ system: "private instructions", messages }));
    expect(responses?.systemHash).toEqual(anthropic?.systemHash);
    expect(responses?.messageHashes).toEqual(anthropic?.messageHashes);
    expect(JSON.stringify(responses)).not.toContain("private instructions");
  });
});
