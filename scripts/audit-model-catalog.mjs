import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { MODEL_REASONING_INVENTORY } from "../apps/web/src/features/settings/model-reasoning-inventory.ts";

const aliases = { anthropic: "anthropic", google: "google", openai: "openai", deepseek: "deepseek", alibaba: "qwen", "alibaba-cn": "qwen", moonshotai: "moonshot", "moonshotai-cn": "moonshot", zai: "zhipu", "zhipuai": "zhipu", xai: "xai", minimax: "minimax", mistral: "mistral", meta: "meta", stepfun: "stepfun", xiaomi: "xiaomi", longcat: "longcat", cohere: "cohere" };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Discovery only: never infer protocol compatibility/effort or change settings.
 * Missing IDs can include aliases, retired models and host-specific offerings. */
export function collectModelCatalogAudit(modelsDev, openRouter, inventory, checkedAt) {
  if (!record(modelsDev) || Object.keys(modelsDev).length === 0) throw new Error("Models.dev returned an empty or invalid provider directory.");
  if (!record(openRouter) || !Array.isArray(openRouter.data) || openRouter.data.length === 0) throw new Error("OpenRouter returned an empty or invalid model directory.");
  const providers = Object.entries(modelsDev).map(([id, provider]) => {
    if (!record(provider) || typeof provider.name !== "string" || !record(provider.models)) throw new Error(`Invalid Models.dev provider: ${id}`);
    const baseline = inventory[aliases[id] ?? id];
    const known = new Set((baseline?.modelIds ?? []).map(value => value.toLowerCase()));
    const models = Object.entries(provider.models).map(([key, model]) => {
      if (!record(model) || typeof model.id !== "string" || model.id !== key) throw new Error(`Invalid Models.dev model: ${id}/${key}`);
      return { id: model.id, name: model.name, reasoning: model.reasoning === true, releaseDate: model.release_date,
        lastUpdated: model.last_updated, status: model.status, discoveryReasoningOptions: model.reasoning_options,
        inVerifiedInventory: known.has(model.id.toLowerCase()) };
    }).sort((a, b) => String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? "")) || a.id.localeCompare(b.id));
    return { id, name: provider.name, documentation: provider.doc, hasVerifiedInventory: baseline !== undefined,
      modelCount: models.length, reasoningCount: models.filter(model => model.reasoning).length,
      unlistedReasoningIds: models.filter(model => model.reasoning && !model.inVerifiedInventory).map(model => model.id), models };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const routerModels = openRouter.data.map(model => {
    if (!record(model) || typeof model.id !== "string") throw new Error("Invalid OpenRouter model.");
    return { id: model.id, name: model.name, created: model.created, supportedParameters: model.supported_parameters };
  });
  const labs = [...new Set(routerModels.map(model => model.id.split("/")[0]))].sort();
  return { checkedAt, sources: { modelsDev: "https://models.dev/api.json", openRouter: "https://openrouter.ai/api/v1/models" },
    notice: "查漏候选，未经逐项官方核实；不代表账户权限、当前在售状态、协议支持或默认推理档位。原厂与网关分别核对。此报告不修改应用配置。",
    summary: { providers: providers.length, providerModelEntries: providers.reduce((count, provider) => count + provider.modelCount, 0),
      reasoningEntries: providers.reduce((count, provider) => count + provider.reasoningCount, 0), openRouterModels: routerModels.length, openRouterLabs: labs.length },
    providers, openRouter: { labs, models: routerModels } };
}

async function readSource(url, file, fetchSource) {
  if (file !== undefined) return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/u, ""));
  const response = await fetchSource(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Catalog download failed (${response.status}): ${url}`);
  return response.json();
}

export async function runModelCatalogAudit(args, { fetchSource = fetch, out = console.log } = {}) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!["--out", "--models-dev-file", "--openrouter-file"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: pnpm catalog:audit --out report.json [--models-dev-file snapshot.json --openrouter-file snapshot.json]");
    options[key] = args[index + 1];
  }
  // Failed sources abort before writing: an unavailable feed is not zero models.
  const [modelsDev, openRouter] = await Promise.all([
    readSource("https://models.dev/api.json", options["--models-dev-file"], fetchSource),
    readSource("https://openrouter.ai/api/v1/models", options["--openrouter-file"], fetchSource),
  ]);
  const report = collectModelCatalogAudit(modelsDev, openRouter, MODEL_REASONING_INVENTORY, new Date().toISOString());
  if (options["--out"]) await writeFile(options["--out"], `${JSON.stringify(report, null, 2)}\n`, "utf8");
  out(JSON.stringify({ ...report.summary, checkedAt: report.checkedAt, report: options["--out"] ?? null }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModelCatalogAudit(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
