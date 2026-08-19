import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const modelSources = [
  "model/model-adapter-registry.ts",
  "model/model-contracts.ts",
  "model/model-credential-store.ts",
  "model/langchain-model-adapter.ts",
];

describe("desktop architecture contracts", () => {
  it("keeps model modules independent from runtime, storage, and tool orchestration", async () => {
    const sources = await Promise.all(
      modelSources.map(async (relativePath) => ({
        relativePath,
        source: await readFile(path.resolve("src/main", relativePath), "utf8"),
      })),
    );

    for (const { relativePath, source } of sources) {
      expect(source, relativePath).not.toMatch(/from ["']\.\.\/(?:storage|agent|tools|tasks)\//);
    }
  });

  it("keeps one explicit registry entry for each supported API format", async () => {
    const source = await readFile(
      path.resolve("src/main/model/model-adapter-registry.ts"),
      "utf8",
    );
    const formats = [
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
      "google-gemini",
    ];

    expect(formats.filter((format) => source.includes(`"${format}"`))).toHaveLength(4);
  });
});
