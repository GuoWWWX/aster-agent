import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectModelCatalogAudit, runModelCatalogAudit } from "./audit-model-catalog.mjs";

const registry = { alibaba: { name: "Alibaba", models: {
  existing: { id: "existing", reasoning: true, release_date: "2026-09-01" },
  newer: { id: "newer", reasoning: true, release_date: "2026-10-15", reasoning_options: [{ type: "effort", values: ["custom"] }] },
  embedding: { id: "embedding", reasoning: false },
} }, unknown: { name: "New Lab", models: { only: { id: "only", reasoning: true } } } };
const router = { data: [{ id: "new-lab/only", supported_parameters: ["reasoning"] }, { id: "new-lab/second" }, { id: "other/test" }] };

test("audits every provider, finds new labs and IDs, preserves source options without promoting them to defaults", () => {
  const before = globalThis.structuredClone(registry);
  const report = collectModelCatalogAudit(registry, router, { qwen: { modelIds: ["EXISTING"] } }, "2026-10-15");
  assert.deepEqual(report.summary, { providers: 2, providerModelEntries: 4, reasoningEntries: 3, openRouterModels: 3, openRouterLabs: 2 });
  assert.deepEqual(report.providers[0].unlistedReasoningIds, ["newer"]);
  assert.equal(report.providers[0].models[0].id, "newer");
  assert.equal(report.providers[1].hasVerifiedInventory, false);
  assert.deepEqual(report.providers[1].unlistedReasoningIds, ["only"]);
  assert.deepEqual(registry, before);
  assert.throws(() => collectModelCatalogAudit({}, router, {}, "now"), /empty or invalid/u);
  assert.throws(() => collectModelCatalogAudit(registry, { data: [] }, {}, "now"), /empty or invalid/u);
  assert.throws(() => collectModelCatalogAudit({ bad: { name: "Bad", models: { wrong: { id: "different" } } } }, router, {}, "now"), /Invalid Models.dev model/u);
});

test("fetch failures preserve an existing report and offline snapshots can reproduce a report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-catalog-audit-"));
  try {
    const output = path.join(directory, "report.json");
    await writeFile(output, "previous");
    await assert.rejects(runModelCatalogAudit(["--out", output], { fetchSource: async () => new Response("unavailable", { status: 503 }), out() {} }), /503/u);
    assert.equal(await readFile(output, "utf8"), "previous");
    const modelsFile = path.join(directory, "models.json");
    const routerFile = path.join(directory, "router.json");
    await writeFile(modelsFile, JSON.stringify(registry));
    await writeFile(routerFile, JSON.stringify(router));
    await runModelCatalogAudit(["--out", output, "--models-dev-file", modelsFile, "--openrouter-file", routerFile], { fetchSource() { throw new Error("Unexpected network request"); }, out() {} });
    assert.equal(JSON.parse(await readFile(output, "utf8")).summary.providers, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
