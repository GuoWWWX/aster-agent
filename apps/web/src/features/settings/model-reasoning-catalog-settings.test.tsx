// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_CATALOG, DEFAULT_MODEL_REASONING_RULES } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ModelReasoningCatalogSettings } from "./model-reasoning-catalog-settings.js";
import { createReasoningCatalogDraft } from "./model-reasoning-catalog-draft.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

async function render(client: MockAgentClient): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><ModelReasoningCatalogSettings agentClient={client} /></TooltipProvider>); await Promise.resolve(); });
  return container;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
function click(label: string): void { act(() => button(label).click()); }
function input(label: string, value: string): void {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`);
  expect(node, label).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(node, value);
    node?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save(): Promise<void> {
  await act(async () => { button("保存修改").click(); await Promise.resolve(); });
}
async function selectProtocol(label: string, trigger = "推理配置对话协议"): Promise<void> {
  await act(async () => { button(trigger).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label);
  expect(option, label).toBeDefined();
  act(() => option?.click());
}

it("keeps protocol options independent, saves a change, and reloads it", async () => {
  const client = new MockAgentClient();
  const container = await render(client);
  expect(container.querySelector("h2")?.textContent).toBe("推理程度");
  act(() => container.querySelector<HTMLInputElement>('[aria-label="启用 低 | low"]')?.click());
  await selectProtocol("OpenAI Responses");
  expect(container.querySelector<HTMLInputElement>('[aria-label="启用 低 | low"]')?.checked).toBe(true);
  await selectProtocol("OpenAI Chat Completions");
  expect(container.querySelector<HTMLInputElement>('[aria-label="启用 低 | low"]')?.checked).toBe(false);
  await selectProtocol("通配符", "模型匹配方式");
  input("模型匹配规则", "gpt-6-*, gpt-6.1-*");
  await save();
  const saved = await client.getModelCatalog();
  expect(saved.reasoningRules?.find(rule => rule.modelKey === "gpt-6.1-sol" && rule.apiFormat === "openai-chat-completions")?.options[0]?.enabled).toBe(false);
  expect(saved.reasoningRules?.find(rule => rule.modelKey === "gpt-6.1-sol" && rule.apiFormat === "openai-responses")?.options[0]?.enabled).toBe(true);
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  const reloaded = await render(client);
  expect(reloaded.querySelector<HTMLInputElement>('[aria-label="启用 低 | low"]')?.checked).toBe(false);
});

it("adds and edits a provider in a dialog and restricts the model protocol menu", async () => {
  const client = new MockAgentClient();
  await render(client);
  click("添加推理供应商");
  click("确定");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("请填写供应商名称");
  input("供应商名称", "My gateway");
  const response = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')][1]!;
  act(() => response.click());
  click("确定");
  click("编辑供应商 My gateway");
  input("供应商名称", "Gateway renamed");
  input("供应商官方文档地址", "https://example.test/reasoning");
  click("供应商图标：自动首字母");
  const logo = document.querySelector<HTMLButtonElement>('[role="option"][title="DeepSeek"]');
  expect(logo).not.toBeNull(); act(() => logo?.click());
  click("确定");
  click("为 Gateway renamed 添加模型");
  input("推理模型名称", "Custom model");
  input("模型匹配规则", "private-model-*");
  expect(document.querySelector<HTMLAnchorElement>('a[href="https://example.test/reasoning"]')).not.toBeNull();
  await selectProtocol("OpenAI Responses");
  click("添加");
  input("新增推理强度显示名称", "深入"); input("新增推理强度接口参数", "deep"); click("完成新增推理强度");
  await selectProtocol("OpenAI Chat Completions");
  expect(document.body.textContent).toContain("尚未配置推理强度");
  await selectProtocol("OpenAI Responses");
  expect(document.body.textContent).toContain("深入");
  click("编辑供应商 Gateway renamed");
  const checked = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')][1]!;
  act(() => checked.click()); click("确定");
  expect(button("推理配置对话协议").textContent).toContain("OpenAI Chat Completions");
  await act(async () => { button("推理配置对话协议").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
  expect([...document.querySelectorAll('[role="option"]')].map(node => node.textContent)).toEqual(["OpenAI Chat Completions"]);
  act(() => document.querySelector<HTMLElement>('[role="option"]')?.click());
  await save();
  const saved = await client.getModelCatalog();
  const provider = saved.reasoningProviders?.find(item => item.name === "Gateway renamed");
  expect(provider).toMatchObject({ icon: "deepseek", sourceUrl: "https://example.test/reasoning", apiFormats: ["openai-chat-completions"] });
  expect(saved.reasoningRules?.find(item => item.providerId === provider?.id && item.apiFormat === "openai-responses")?.options).toEqual([{ kind: "custom_effort", value: "deep", displayName: "深入", enabled: true }]);
  click("编辑供应商 Gateway renamed");
  act(() => document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')[1]?.click()); click("确定");
  await selectProtocol("OpenAI Responses");
  expect(document.body.textContent).toContain("深入");
});

it("confirms provider deletion and keeps an explicitly empty catalog empty after reload", async () => {
  const client = new MockAgentClient();
  await client.saveModelCatalog({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [DEFAULT_MODEL_CATALOG.reasoningProviders![0]!],
    reasoningRules: DEFAULT_MODEL_REASONING_RULES.filter(rule => rule.providerId === "openai") });
  await render(client);
  click("删除供应商 OpenAI"); click("取消"); expect(document.body.textContent).toContain("gpt-6.1-sol");
  click("删除供应商 OpenAI"); click("确认删除"); await save();
  expect(await client.getModelCatalog()).toMatchObject({ reasoningProviders: [], reasoningRules: [] });
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  expect((await render(client)).textContent).toContain("暂无供应商");
});

it("uploads and persists a local logo, rejects unsupported files, and can return to a built-in logo", async () => {
  const client = new MockAgentClient();
  await render(client);
  click("编辑供应商 OpenAI");
  const picker = document.querySelector<HTMLInputElement>('[aria-label="供应商 Logo 文件"]')!;
  const chooseFile = vi.spyOn(picker, "click");
  click("上传供应商 Logo"); expect(chooseFile).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "上传图片")).toBe(false);
  Object.defineProperty(picker, "files", { configurable: true, value: [new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" })] });
  act(() => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("PNG、JPEG");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: png }); this.dispatchEvent(new Event("load"));
  });
  Object.defineProperty(picker, "files", { configurable: true, value: [new File(["image"], "logo.png", { type: "image/png" })] });
  act(() => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(document.querySelector<HTMLImageElement>('[role="dialog"] img')?.src).toBe(png);
  click("确定"); await save();
  expect((await client.getModelCatalog()).reasoningProviders?.find(item => item.id === "openai")?.imageDataUrl).toBe(png);
  click("编辑供应商 OpenAI"); click("供应商图标：OpenAI");
  act(() => document.querySelector<HTMLButtonElement>('[role="option"][title="Google Gemini"]')?.click());
  click("确定"); await save();
  const provider = (await client.getModelCatalog()).reasoningProviders?.find(item => item.id === "openai");
  expect(provider?.imageDataUrl).toBeUndefined(); expect(provider?.icon).toBe("google");
});

it("preserves the draft and exposes retry when saving fails", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "saveModelCatalog").mockRejectedValue(new Error("write failed"));
  const container = await render(client);
  click("为 OpenAI 添加模型"); await save();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("保存失败");
  expect(container.textContent).toContain("新模型"); expect(button("保存修改").disabled).toBe(false);
});

it("validates regex patterns without splitting quantifier commas and persists exact mode separately", async () => {
  const client = new MockAgentClient();
  await render(client);
  await selectProtocol("正则表达式", "模型匹配方式");
  input("模型匹配规则", "^(gpt|model)-[0-9]{1,3}$");
  await save();
  const rule = (await client.getModelCatalog()).reasoningRules?.find(item => item.modelKey === "gpt-6.1-sol");
  expect(rule).toMatchObject({ matchMode: "regex", matches: ["^(gpt|model)-[0-9]{1,3}$"] });
  input("模型匹配规则", "["); await save();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("正则表达式必须有效");
  await selectProtocol("指定具体模型", "模型匹配方式"); input("模型匹配规则", "my-model"); await save();
  expect((await client.getModelCatalog()).reasoningRules?.find(item => item.modelKey === "gpt-6.1-sol")).toMatchObject({ matchMode: "exact", matches: ["my-model"] });
});

it("retains older flat custom rules while preparing the supplier tree", () => {
  const catalog = createReasoningCatalogDraft({ defaultContextWindow: 12345, models: [], version: 1,
    reasoningRules: [{ id: "old-custom", name: "Old model", matches: ["old-*"], apiFormat: "openai-responses", options: [] }] });
  expect(catalog.reasoningProviders.some(provider => provider.id === "custom")).toBe(true);
  expect(catalog.reasoningRules[0]).toMatchObject({ id: "old-custom", providerId: "custom", modelKey: "old-custom", matches: ["old-*"] });
  expect(catalog.defaultContextWindow).toBe(12345);
});

it("adds missing built-in models without replacing existing overrides", async () => {
  const client = new MockAgentClient();
  const override = { ...DEFAULT_MODEL_REASONING_RULES[0]!, options: [] };
  await client.saveModelCatalog({ ...DEFAULT_MODEL_CATALOG, reasoningRules: [override] });
  await render(client); click("补齐内置模型"); await save();
  const saved = await client.getModelCatalog();
  expect(saved.reasoningRules).toHaveLength(DEFAULT_MODEL_REASONING_RULES.length);
  expect(saved.reasoningRules?.find(item => item.id === override.id)?.options).toEqual([]);
  expect(saved.reasoningRules?.some(item => item.modelKey === "claude-opus-5-5")).toBe(true);
});
