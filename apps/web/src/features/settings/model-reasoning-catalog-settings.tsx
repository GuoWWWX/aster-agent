import { useEffect, useState, type ReactElement } from "react";
import { Boxes, ChevronDown, ChevronRight, CirclePlus, ListPlus, Pencil, RotateCcw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { DEFAULT_MODEL_CATALOG, DEFAULT_MODEL_REASONING_PROVIDERS, DEFAULT_MODEL_REASONING_RULES, modelCatalogSchema,
  type ModelApiFormat, type ModelReasoningProvider, type ModelReasoningRule } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select.js";
import { ModelReasoningOptionsEditor } from "./model-reasoning-options-editor.js";
import { SettingsConfigurationGroup } from "./settings-configuration-card.js";
import { createReasoningCatalogDraft, reasoningCatalogModels, reasoningCatalogModelMatchesSearch, REASONING_API_FORMATS, type ReasoningCatalogDraft, type ReasoningCatalogModel } from "./model-reasoning-catalog-draft.js";
import { ReasoningProviderDialog, ReasoningProviderLogo } from "./reasoning-provider-dialog.js";

const inputClass = "h-8 w-full min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]";
type Selection = { providerId: string; key: string };
type Deletion = { kind: "provider"; provider: ModelReasoningProvider } | { kind: "model"; model: ReasoningCatalogModel };

export function ModelReasoningCatalogSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [catalog, setCatalog] = useState<ReasoningCatalogDraft | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [apiFormat, setApiFormat] = useState<ModelApiFormat>("openai-chat-completions");
  const [expanded, setExpanded] = useState(new Set(["openai"]));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [providerDialog, setProviderDialog] = useState<{ provider: ModelReasoningProvider; isNew: boolean } | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);

  useEffect(() => {
    let disposed = false;
    void agentClient.getModelCatalog().then(value => {
      if (!disposed) setCatalog(createReasoningCatalogDraft(value));
    }).catch(() => { if (!disposed) setError("无法读取推理程度配置，请重新打开此页面重试。"); });
    return () => { disposed = true; };
  }, [agentClient]);

  const rules = catalog?.reasoningRules ?? [];
  const providers = catalog?.reasoningProviders ?? [];
  const models = reasoningCatalogModels(rules);
  const selected = models.find(model => model.key === selection?.key && model.providerId === selection.providerId) ?? models[0] ?? null;
  const provider = providers.find(item => item.id === selected?.providerId);
  const activeFormat = provider?.apiFormats.includes(apiFormat) ? apiFormat : provider?.apiFormats[0] ?? apiFormat;
  const rule = selected?.rules.find(item => item.apiFormat === activeFormat);
  const original = DEFAULT_MODEL_REASONING_RULES.find(item => item.providerId === provider?.id
    && item.modelKey === selected?.key && item.apiFormat === activeFormat);
  const search = query.trim().toLocaleLowerCase();

  function change(next: ReasoningCatalogDraft): void {
    if (saving) return;
    setCatalog(next);
    setDirty(true);
    setError(null);
  }

  function updateModel(patch: Pick<Partial<ModelReasoningRule>, "name" | "matches" | "matchMode">): void {
    if (catalog === null || selected === null) return;
    change({ ...catalog, reasoningRules: rules.map(item => item.providerId === selected.providerId && item.modelKey === selected.key ? { ...item, ...patch } : item) });
  }

  function updateRule(patch: Partial<ModelReasoningRule>): void {
    if (catalog === null || selected === null) return;
    if (rule !== undefined) change({ ...catalog, reasoningRules: rules.map(item => item.id === rule.id ? { ...item, ...patch } : item) });
    else change({ ...catalog, reasoningRules: [...rules, { id: crypto.randomUUID(), providerId: selected.providerId, modelKey: selected.key,
      name: selected.name, matches: [...selected.matches], matchMode: selected.matchMode, apiFormat: activeFormat, options: [], ...patch }] });
  }

  function addModel(target: ModelReasoningProvider): void {
    if (catalog === null) return;
    const key = crypto.randomUUID();
    const format = target.apiFormats[0]!;
    change({ ...catalog, reasoningRules: [...rules, { id: crypto.randomUUID(), providerId: target.id, modelKey: key,
      name: "新模型", matches: ["model-id"], matchMode: "exact", apiFormat: format, options: [] }] });
    setSelection({ providerId: target.id, key });
    setApiFormat(format);
    setQuery("");
    setExpanded(current => new Set([...current, target.id]));
  }

  function completeBuiltinModels(): void {
    if (catalog === null) return;
    const nextProviders = [...providers, ...structuredClone(DEFAULT_MODEL_REASONING_PROVIDERS.filter(item => !providers.some(current => current.id === item.id)))];
    const nextRules = structuredClone(DEFAULT_MODEL_REASONING_RULES.filter(item => !rules.some(current => current.id === item.id
      || (current.providerId === item.providerId && current.modelKey === item.modelKey && current.apiFormat === item.apiFormat))));
    // New defaults precede user rules so existing overrides retain precedence.
    change({ ...catalog, reasoningProviders: nextProviders, reasoningRules: [...nextRules, ...rules] });
  }

  function saveProvider(next: ModelReasoningProvider): void {
    if (catalog === null) return;
    change({ ...catalog, reasoningProviders: providerDialog?.isNew ? [...providers, next] : providers.map(item => item.id === next.id ? next : item) });
    setExpanded(current => new Set([...current, next.id]));
    if (provider?.id === next.id && !next.apiFormats.includes(apiFormat)) setApiFormat(next.apiFormats[0]!);
    setProviderDialog(null);
    setQuery("");
  }

  function confirmDeletion(): void {
    if (catalog === null || deletion === null) return;
    if (deletion.kind === "provider") change({ ...catalog,
      reasoningProviders: providers.filter(item => item.id !== deletion.provider.id),
      reasoningRules: rules.filter(item => item.providerId !== deletion.provider.id) });
    else change({ ...catalog, reasoningRules: rules.filter(item => item.providerId !== deletion.model.providerId || item.modelKey !== deletion.model.key) });
    setDeletion(null);
  }

  async function save(): Promise<void> {
    const parsed = modelCatalogSchema.safeParse(catalog);
    if (!parsed.success) { setError("请检查供应商、模型名称、匹配规则和推理参数；名称与匹配规则不能为空，正则表达式必须有效。"); return; }
    setSaving(true);
    setError(null);
    try {
      setCatalog(createReasoningCatalogDraft(await agentClient.saveModelCatalog(parsed.data)));
      setDirty(false);
    } catch { setError("保存失败，请重试；当前修改已保留。"); }
    finally { setSaving(false); }
  }

  return <section className="settings-section" aria-label="推理程度配置">
    <header className="settings-section__header">
      <div className="settings-section__title-row"><h2>推理程度</h2><p className="settings-section__description">按供应商、模型与协议维护默认推理档位</p>
        <nav aria-label="模型查新来源" className="flex flex-wrap gap-2 text-[length:var(--app-font-size-control)] text-[var(--app-accent)]">
          <a href="https://models.dev/" target="_blank" rel="noreferrer">Models.dev 型号目录 ↗</a>
          <a href="https://openrouter.ai/models?order=newest" target="_blank" rel="noreferrer">OpenRouter 最新发布 ↗</a>
        </nav>
      </div>
      <button type="button" className="settings-primary-button" disabled={catalog === null || saving || !dirty} onClick={() => void save()}>
        {saving ? "保存中…" : dirty ? "保存修改" : "已保存"}
      </button>
    </header>
    <div className="settings-section__body settings-section__body--models">
      {error !== null ? <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}</p> : null}
      {catalog === null ? error === null ? <p role="status">正在读取配置…</p> : null : <div className="settings-provider-manager">
        <aside className="settings-provider-list" aria-label="推理程度供应商与模型">
          <header className="settings-provider-list__heading">
            <strong>供应商与模型</strong>
            <div className="flex shrink-0"><IconButton label="补齐内置模型" disabled={saving} onClick={completeBuiltinModels}><ListPlus size={17} /></IconButton>
            <IconButton label="添加推理供应商" disabled={saving} onClick={() => setProviderDialog({ isNew: true,
              provider: { id: crypto.randomUUID(), name: "", icon: "auto", apiFormats: ["openai-chat-completions"] } })}><CirclePlus size={18} /></IconButton>
            </div>
          </header>
          <div className="settings-provider-list__body">
            <label className="settings-provider-list__search app-search-field"><Search aria-hidden="true" size={14} />
              <input aria-label="搜索供应商或模型" autoComplete="off" placeholder="搜索供应商或模型" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <div className="settings-provider-list__items" inert={saving}>
              {providers.map(item => {
                const children = models.filter(model => model.providerId === item.id);
                const visible = children.filter(model => reasoningCatalogModelMatchesSearch(model, item.name, search));
                if (search && visible.length === 0 && !item.name.toLocaleLowerCase().includes(search)) return null;
                const isExpanded = expanded.has(item.id) || search.length > 0;
                return <div key={item.id}>
                  <div className="group/provider relative min-w-0">
                    <button type="button" aria-expanded={isExpanded} aria-label={`${isExpanded ? "收起" : "展开"} ${item.name}`}
                      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[var(--app-radius)] px-1 text-left text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
                      onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>
                      {isExpanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                      <ReasoningProviderLogo provider={item} /><span className="truncate" title={item.name}>{item.name}</span>
                    </button>
                    <div className="absolute right-0 top-0 hidden h-9 items-center rounded-[var(--app-radius)] bg-[var(--app-panel)] px-1 group-hover/provider:flex group-focus-within/provider:flex">
                      <IconButton size="compact" label={`编辑供应商 ${item.name}`} onClick={() => setProviderDialog({ provider: item, isNew: false })}><Pencil size={14} /></IconButton>
                      <IconButton size="compact" label={`为 ${item.name} 添加模型`} onClick={() => addModel(item)}><CirclePlus size={14} /></IconButton>
                      <IconButton size="compact" label={`删除供应商 ${item.name}`} onClick={() => setDeletion({ kind: "provider", provider: item })}><Trash2 size={14} /></IconButton>
                    </div>
                  </div>
                  {isExpanded ? <ul className="m-0 ml-4 grid list-none gap-[2px] border-l border-[var(--app-border)] py-1 pl-2">
                    {visible.map(model => <li key={model.key} className="group/model relative min-w-0">
                      <button type="button" aria-pressed={selected?.key === model.key && selected.providerId === item.id} title={model.name}
                        className="block h-8 w-full min-w-0 truncate rounded-[var(--app-radius)] px-2 text-left text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] aria-pressed:bg-[var(--app-selection)] aria-pressed:text-[var(--app-selection-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
                        onClick={() => { setSelection({ providerId: item.id, key: model.key }); setApiFormat(model.rules.find(value => item.apiFormats.includes(value.apiFormat))?.apiFormat ?? item.apiFormats[0]!); }}>{model.name}</button>
                      <div className="absolute right-0 top-0 hidden h-8 items-center bg-[var(--app-panel)] px-1 group-hover/model:flex group-focus-within/model:flex">
                        <IconButton size="compact" label={`删除模型 ${model.name}`} onClick={() => setDeletion({ kind: "model", model })}><Trash2 size={14} /></IconButton>
                      </div>
                    </li>)}
                    {visible.length === 0 ? <li className="px-2 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">暂无模型，点击供应商右侧 ＋ 添加</li> : null}
                  </ul> : null}
                </div>;
              })}
              {providers.length === 0 ? <p className="settings-provider-list__empty">暂无供应商，请先添加。</p> : null}
              {search && !models.some(model => reasoningCatalogModelMatchesSearch(model, providers.find(item => item.id === model.providerId)?.name ?? "", search))
                && !providers.some(item => item.name.toLocaleLowerCase().includes(search)) ? <p className="settings-provider-list__empty">未找到匹配的供应商或模型</p> : null}
            </div>
          </div>
          <footer className="settings-provider-list__pagination"><span className="settings-provider-list__count">{providers.length} 家供应商 · {models.length} 个配置组</span></footer>
        </aside>
        <div className="settings-provider-editor" inert={saving}>
          {selected === null || provider === undefined ? <p className="text-[var(--app-muted-foreground)]">添加供应商和模型后配置推理程度。</p> : <>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><ReasoningProviderLogo provider={provider} /><strong className="truncate text-[length:var(--app-font-size-subtitle)]" title={selected.name}>{selected.name}</strong></div>
              <IconButton label="恢复当前协议默认档位" disabled={original === undefined} onClick={() => { if (original !== undefined) updateRule({ options: structuredClone(original.options) }); }}><RotateCcw size={16} /></IconButton>
            </div>
            <SettingsConfigurationGroup cardAriaLabel="推理模型基本配置" cardClassName="settings-provider-profile" icon={Boxes} title="基本配置">
              <div className="settings-provider-editor__body">
                <div className="settings-provider-fields">
                  <label>模型名称<input aria-label="推理模型名称" maxLength={200} className={inputClass} value={selected.name} onChange={event => updateModel({ name: event.target.value })} /></label>
                  <label>对话协议
                    <Select value={activeFormat} onValueChange={value => {
                      const format = REASONING_API_FORMATS.find(item => item.value === value)?.value;
                      if (format !== undefined) setApiFormat(format);
                    }}>
                      <SelectTrigger aria-label="推理配置对话协议"><SelectValue /></SelectTrigger>
                      <SelectContent>{REASONING_API_FORMATS.filter(format => provider.apiFormats.includes(format.value)).map(format => <SelectItem key={format.value} value={format.value}>{format.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                  <label>匹配方式
                    <Select value={selected.matchMode} onValueChange={value => { if (value === "exact" || value === "glob" || value === "regex") updateModel({ matchMode: value }); }}>
                      <SelectTrigger aria-label="模型匹配方式"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="exact">指定具体模型</SelectItem><SelectItem value="glob">通配符</SelectItem><SelectItem value="regex">正则表达式</SelectItem></SelectContent>
                    </Select>
                  </label>
                  <label className="col-span-full">模型匹配规则<textarea aria-label="模型匹配规则" rows={selected.matchMode === "regex" ? 3 : 2}
                    className="w-full min-w-0 resize-y rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 py-1 text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
                    value={selected.matches.join("\n")} onChange={event => updateModel({ matches: event.target.value.split(selected.matchMode === "regex" ? /\n/u : /[,，\n]/u).map(value => value.trim()) })} /></label>
                </div>
                <p className="m-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
                  {selected.matchMode === "regex" ? "每行一个 RE2 正则表达式，例如 ^claude-(opus|sonnet)-5(-5)?$；不加 / 分隔符，默认忽略大小写。" : selected.matchMode === "exact" ? "每行一个完整模型 ID，例如 claude-opus-5-5；不将 * 当作通配符。" : "每行一个匹配模式，* 匹配任意字符；也可用逗号分隔。"}
                  兼容带供应商前缀的模型 ID。名称和匹配规则在该模型各协议间共用。
                </p>
              </div>
            </SettingsConfigurationGroup>
            <SettingsConfigurationGroup cardAriaLabel="模型推理档位配置" icon={SlidersHorizontal} title="推理档位">
              {rule === undefined ? <p className="mt-0 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">此协议尚未配置；可添加档位，或恢复内置默认。</p> : null}
              <ModelReasoningOptionsEditor key={`${provider.id}-${selected.key}-${activeFormat}`} apiFormat={activeFormat} modelId={selected.matches[0]?.replaceAll("*", "") ?? ""}
                modelName={selected.name} options={rule?.options ?? []} catalog={DEFAULT_MODEL_CATALOG} showTitle={false} onChange={options => updateRule({ options })} />
              <p className="mb-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">自动：不指定参数，沿用服务默认；不表示关闭推理。各协议的档位分别保存。</p>
              {rule?.note ? <p className="mb-0 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{rule.note}</p> : null}
              {provider.sourceUrl ? <a className="mt-2 inline-block text-[length:var(--app-font-size-control)] text-[var(--app-accent)]" href={provider.sourceUrl} target="_blank" rel="noreferrer">查看官方文档 ↗</a> : null}
            </SettingsConfigurationGroup>
          </>}
        </div>
      </div>}
    </div>
    {providerDialog === null ? null : <ReasoningProviderDialog key={providerDialog.provider.id} {...providerDialog} onClose={() => setProviderDialog(null)} onSave={saveProvider} />}
    {deletion === null ? null : <Dialog open onOpenChange={open => { if (!open) setDeletion(null); }}><DialogContent className="gap-4 border border-[var(--app-border)] p-4">
      <DialogHeader><DialogTitle>{deletion.kind === "provider" ? "删除供应商" : "删除模型"}</DialogTitle>
        <DialogDescription>{deletion.kind === "provider" ? `删除“${deletion.provider.name}”及其全部模型和协议配置？` : `删除“${deletion.model.name}”在所有协议下的推理配置？`}保存修改后生效。</DialogDescription></DialogHeader>
      <DialogFooter><button type="button" className="settings-secondary-button" onClick={() => setDeletion(null)}>取消</button><button type="button" className="settings-primary-button" onClick={confirmDeletion}>确认删除</button></DialogFooter>
    </DialogContent></Dialog>}
  </section>;
}
