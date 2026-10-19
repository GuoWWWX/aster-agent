import { getModelSettingsSaveQueue } from "./model-settings-save-queue.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  type ContextCompressionConfiguration,
  type ContextCompressionThreshold,
  type DiscoveredModel,
  type ModelCatalog,
  type ModelProviderIcon,
  type ModelProfile,
  type ModelReasoningOption,
  type ModelRuntimeStatus,
  type SaveModelConfigurationInput,
} from "@agent/protocol";
import { getUserErrorMessage, type AgentClient } from "../../../runtime/index.js";
import { loadModelStatus, rememberModelStatus } from "../../../runtime/model-status-cache.js";
import { formatModelContextWindow, parseModelContextWindow } from "../model-context-window.js";
import { defaultModelContextWindow, defaultReasoningOptions } from "../model-reasoning-options.js";
import {
  type ConfiguredProvider,
  type ActiveProviderId,
  type ProviderSaveState,
  type ModelTestResultState,
  type ConfiguredModelDraft,
  DEFAULT_MODEL_API_FORMAT,
  PROVIDERS_PER_PAGE,
  MODEL_TEST_BATCH_SIZE,
  contextCompressionThreshold,
  getConfiguredProviders,
  isOptionalUrlValid,
} from "./model-provider-state.js";
import { errorMessage } from "../configuration-state.js";

type PendingModelSave = {
  input: SaveModelConfigurationInput | null;
  revision: number;
  creationOwner: object;
};

export function useModelSettingsController({ agentClient }: { agentClient: AgentClient }) {
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [draft, setDraft] = useState({
    apiKey: "",
    apiFormat: DEFAULT_MODEL_API_FORMAT,
    baseUrl: "",
    providerIcon: "auto" as ModelProviderIcon,
    providerName: "",
    providerNote: "",
    providerWebsiteUrl: "",
  });
  // undefined means the saved default has not been resolved yet; null is an explicit new-provider draft.
  const [activeProviderId, setActiveProviderId] = useState<ActiveProviderId>(undefined);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [configuredModelDrafts, setConfiguredModelDrafts] = useState<ConfiguredModelDraft[]>([]);
  const [expandedModelIds, setExpandedModelIds] = useState<string[]>([]);
  const [globalContextCompression, setGlobalContextCompression] = useState<ContextCompressionConfiguration>(
    DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  );
  const [isGlobalContextCompressionLoaded, setIsGlobalContextCompressionLoaded] = useState(false);
  const [editingReasoningModelId, setEditingReasoningModelId] = useState<string | null>(null);
  const [isDefaultModelSaving, setIsDefaultModelSaving] = useState(false);
  const [isModelTestDialogOpen, setIsModelTestDialogOpen] = useState(false);
  const [modelTestSelection, setModelTestSelection] = useState<string[]>([]);
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestResultState>>({});
  const [operationError, setOperationError] = useState<string | null>(null);
  const [providerPage, setProviderPage] = useState(0);
  const [providerSaveState, setProviderSaveState] = useState<ProviderSaveState>("idle");
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [saveRevision, setSaveRevision] = useState(0);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>(DEFAULT_MODEL_CATALOG);
  const [status, setStatus] = useState<ModelRuntimeStatus | null>(null);
  const autoSaveInputRef = useRef<SaveModelConfigurationInput | null>(null);
  const handledSaveRevisionRef = useRef(0);
  const latestSaveRevisionRef = useRef(0);
  const selectedProviderIdRef = useRef<string | null>(null);
  const saveQueue = getModelSettingsSaveQueue(agentClient);
  const mountedRef = useRef(false);
  const pendingAutoSaveRef = useRef<PendingModelSave | null>(null);
  const newProviderOwnerRef = useRef<object>({});
  const autoSaveTimerRef = useRef<number | null>(null);
  const nextModelDraftIdRef = useRef(1);
  const newModelContextDefaultIdsRef = useRef(new Set<string>());
  const newModelReasoningDefaultIdsRef = useRef(new Set<string>());
  const globalContextCompressionRef = useRef(globalContextCompression);

  useEffect(() => {
    if (!isModelTestDialogOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setIsModelTestDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isModelTestDialogOpen]);

  const handleGlobalContextCompressionChange = useCallback((configuration: ContextCompressionConfiguration) => {
    globalContextCompressionRef.current = configuration;
    setGlobalContextCompression(configuration);
    setIsGlobalContextCompressionLoaded(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    void saveQueue.waitForIdle().then(() => loadModelStatus(agentClient))
      .then((nextStatus) => {
        if (disposed) return;
        setStatus(nextStatus);
        const failedDraft = saveQueue.lastFailedDraft();
        setActiveProviderId((current) => current === undefined
          ? failedDraft === null ? nextStatus.providerId ?? getConfiguredProviders(nextStatus.models)[0]?.id ?? null : failedDraft.providerId ?? null
          : current);
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取已保存的模型配置");
      });
    return () => {
      disposed = true;
    };
  }, [agentClient, saveQueue]);

  useEffect(() => {
    let disposed = false;
    void agentClient
      .getModelCatalog()
      .then((catalog) => {
        if (!disposed) setModelCatalog(catalog);
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取模型目录配置");
      });
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  const providers = useMemo(
    () => getConfiguredProviders(status?.models ?? []),
    [status?.models],
  );
  const normalizedProviderSearchQuery = providerSearchQuery.trim().toLocaleLowerCase();
  const filteredProviders = useMemo(() => providers.filter((provider) => (
    normalizedProviderSearchQuery.length === 0 || [
      provider.name,
      provider.note,
      provider.websiteUrl,
      provider.baseUrl,
    ]
      .some((value) => value.toLocaleLowerCase().includes(normalizedProviderSearchQuery))
  )), [normalizedProviderSearchQuery, providers]);
  const providerPageCount = Math.max(1, Math.ceil(filteredProviders.length / PROVIDERS_PER_PAGE));
  const currentProviderPage = Math.min(providerPage, providerPageCount - 1);
  const pagedProviders = filteredProviders.slice(
    currentProviderPage * PROVIDERS_PER_PAGE,
    (currentProviderPage + 1) * PROVIDERS_PER_PAGE,
  );
  const selectedProviderId = activeProviderId === undefined
    ? status?.providerId ?? providers[0]?.id ?? null
    : activeProviderId;
  const activeProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const savedProviderModels = useMemo(
    () => (status?.models ?? []).filter((model) => model.providerId === selectedProviderId),
    [selectedProviderId, status?.models],
  );
  const activeProviderRef = useRef<ConfiguredProvider | null>(null);
  const savedProviderModelsRef = useRef<readonly ModelProfile[]>([]);
  const normalizedModelIds = configuredModelDrafts.map((model) => model.modelId.trim());
  const hasValidConfiguredModels =
    configuredModelDrafts.length > 0 &&
    normalizedModelIds.every((modelId) => modelId.length > 0) &&
    configuredModelDrafts.every((model) => model.displayName.trim().length > 0) &&
    configuredModelDrafts.every((model) => parseModelContextWindow(model.contextWindow) !== null) &&
    new Set(normalizedModelIds).size === normalizedModelIds.length;
  const testableModels = configuredModelDrafts.filter((model) => model.modelId.trim().length > 0);
  const selectedTestableModelCount = testableModels.filter((model) => modelTestSelection.includes(model.id)).length;
  const isAnyModelTesting = Object.values(modelTestResults).some((result) => result.kind === "testing");

  const autoSaveInput = useMemo<SaveModelConfigurationInput | null>(() => (
    draft.baseUrl.trim().length > 0 &&
    draft.apiKey.trim().length > 0 &&
    draft.providerName.trim().length > 0 &&
    isOptionalUrlValid(draft.providerWebsiteUrl) &&
    hasValidConfiguredModels
      ? {
          apiKey: draft.apiKey,
          apiFormat: draft.apiFormat,
          baseUrl: draft.baseUrl,
          models: configuredModelDrafts.map((model) => ({
            ...(model.modelType === undefined ? {} : { modelType: model.modelType }),
            contextCompression: model.contextCompression,
            contextWindow: parseModelContextWindow(model.contextWindow) ?? 0,
            displayName: model.displayName.trim(),
            modelId: model.modelId.trim(),
            reasoningOptions: model.reasoningOptions,
          })),
          ...(selectedProviderId === null ? {} : { providerId: selectedProviderId }),
          providerIcon: draft.providerIcon,
          providerName: draft.providerName,
          ...(draft.providerNote.trim().length === 0
            ? {}
            : { providerNote: draft.providerNote.trim() }),
          ...(draft.providerWebsiteUrl.trim().length === 0
            ? {}
            : { providerWebsiteUrl: draft.providerWebsiteUrl.trim() }),
        }
      : null
  ), [
    configuredModelDrafts,
    draft.apiFormat,
    draft.apiKey,
    draft.baseUrl,
    draft.providerIcon,
    draft.providerName,
    draft.providerNote,
    draft.providerWebsiteUrl,
    hasValidConfiguredModels,
    selectedProviderId,
  ]);

  useEffect(() => {
    selectedProviderIdRef.current = selectedProviderId;
  }, [selectedProviderId]);

  useEffect(() => {
    activeProviderRef.current = activeProvider;
    savedProviderModelsRef.current = savedProviderModels;
  }, [activeProvider, savedProviderModels]);

  useEffect(() => {
    autoSaveInputRef.current = autoSaveInput;
  }, [autoSaveInput]);

  const saveSnapshot = useCallback((snapshot: PendingModelSave): void => {
    if (snapshot.input === null) {
      if (mountedRef.current) setProviderSaveState("incomplete");
      return;
    }
    const input = snapshot.input;
    const isCurrentEditor = (): boolean => mountedRef.current
      && selectedProviderIdRef.current === (input.providerId ?? null)
      && (input.providerId !== undefined || snapshot.creationOwner === newProviderOwnerRef.current);
    if (isCurrentEditor()) setProviderSaveState("saving");
    void saveQueue.saveProvider(input, snapshot.creationOwner).then(nextStatus => {
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      if (!isCurrentEditor()) return;
      if (input.providerId === undefined && latestSaveRevisionRef.current === snapshot.revision) {
        const savedProviderId = saveQueue.createdProviderFor(snapshot.creationOwner);
        if (savedProviderId !== null) setActiveProviderId(savedProviderId);
      }
      if (latestSaveRevisionRef.current === snapshot.revision) {
        setOperationError(null);
        setProviderSaveState("saved");
      }
    }).catch(() => {
      if (isCurrentEditor() && latestSaveRevisionRef.current === snapshot.revision) {
        setOperationError("模型配置更新失败");
        setProviderSaveState("idle");
      }
    });
  }, [saveQueue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      const pending = pendingAutoSaveRef.current;
      pendingAutoSaveRef.current = null;
      if (pending !== null) saveSnapshot(pending);
    };
  }, [saveSnapshot]);

  useEffect(() => {
    if (saveRevision === 0 || handledSaveRevisionRef.current === saveRevision) return;
    handledSaveRevisionRef.current = saveRevision;
    const snapshot = { input: autoSaveInputRef.current, revision: saveRevision, creationOwner: newProviderOwnerRef.current };
    pendingAutoSaveRef.current = snapshot;
    const timer = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (pendingAutoSaveRef.current !== snapshot) return;
      pendingAutoSaveRef.current = null;
      saveSnapshot(snapshot);
    }, 450);
    autoSaveTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [saveRevision, saveSnapshot]);

  useEffect(() => {
    if (!isGlobalContextCompressionLoaded) return;
    const provider = activeProviderRef.current;
    const failedDraft = saveQueue.failedDraftFor(provider?.id ?? null);
    if (provider === null && failedDraft === null) return;
    let disposed = false;
    const providerModels = failedDraft?.models ?? savedProviderModelsRef.current;
    const modelDrafts = providerModels.map((model) => ({
      ...(model.modelType === undefined ? {} : { modelType: model.modelType }),
      contextCompression: model.contextCompression
        ?? contextCompressionThreshold(globalContextCompressionRef.current),
      contextWindow: formatModelContextWindow(model.contextWindow),
      displayName: model.displayName,
      id: `model-${nextModelDraftIdRef.current++}`,
      modelId: model.modelId,
      reasoningOptions: model.reasoningOptions,
    }));
    setDraft({
      apiKey: failedDraft?.apiKey ?? "",
      apiFormat: failedDraft?.apiFormat ?? provider!.apiFormat,
      baseUrl: failedDraft?.baseUrl ?? provider!.baseUrl,
      providerIcon: failedDraft?.providerIcon ?? provider?.icon ?? "auto",
      providerName: failedDraft?.providerName ?? provider!.name,
      providerNote: failedDraft?.providerNote ?? provider?.note ?? "",
      providerWebsiteUrl: failedDraft?.providerWebsiteUrl ?? provider?.websiteUrl ?? "",
    });
    setConfiguredModelDrafts(modelDrafts);
    setEditingReasoningModelId(null);
    setModelTestResults({});

    setOperationError(failedDraft === null ? null : "模型配置更新失败");
    setProviderSaveState("idle");
    if (failedDraft !== null || provider === null) return;

    void agentClient
      .getModelApiKey(provider.id)
      .then((apiKey) => {
        if (disposed) return;
        setDraft((current) => ({ ...current, apiKey: apiKey ?? "" }));
      })
      .catch(() => {
        if (!disposed) {
          setOperationError("API Key 读取失败，请检查 settings.jsonc 中对应供应商的配置");
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeProviderId, agentClient, isGlobalContextCompressionLoaded, saveQueue]);

  function updateDraft(event: ChangeEvent<HTMLInputElement>): void {
    setDraft((current) => ({ ...current, [event.target.name]: event.target.value }));
    markProviderConfigurationChanged();
  }

  function setReasoningOptions(
    modelDraftId: string,
    reasoningOptions: ModelReasoningOption[],
  ): void {
    newModelReasoningDefaultIdsRef.current.delete(modelDraftId);
    setConfiguredModelDrafts((current) => current.map((model) =>
      model.id === modelDraftId ? { ...model, reasoningOptions } : model,
    ));
    markProviderConfigurationChanged();
  }

  function setContextWindow(modelDraftId: string, value: string): void {
    newModelContextDefaultIdsRef.current.delete(modelDraftId);
    setConfiguredModelDrafts((current) => current.map((model) =>
      model.id === modelDraftId ? { ...model, contextWindow: value } : model,
    ));
    markProviderConfigurationChanged();
  }

  function setModelContextCompression(
    modelDraftId: string,
    contextCompression: ContextCompressionThreshold,
  ): void {
    setConfiguredModelDrafts((current) => current.map((model) =>
      model.id === modelDraftId ? { ...model, contextCompression } : model,
    ));
    markProviderConfigurationChanged();
  }

  function updateModelId(modelDraftId: string, value: string): void {
    const discoveredType = discoveredModels.find(model => model.modelId === value)?.modelType;
    const shouldApplyReasoningDefaults = newModelReasoningDefaultIdsRef.current.has(modelDraftId);
    const shouldApplyContextWindowDefault = newModelContextDefaultIdsRef.current.has(modelDraftId);
    setConfiguredModelDrafts((current) => current.map((model) => {
      if (model.id !== modelDraftId) return model;
      return {
        ...model,
        contextWindow: shouldApplyContextWindowDefault
          ? formatModelContextWindow(defaultModelContextWindow(value, modelCatalog))
          : model.contextWindow,
        displayName: model.displayName.length === 0 || model.displayName === model.modelId
          ? value
          : model.displayName,
        modelId: value,
        ...(model.modelType === undefined && discoveredType !== undefined ? { modelType: discoveredType } : {}),
        reasoningOptions: shouldApplyReasoningDefaults
          ? value.trim().length === 0 ? [] : defaultReasoningOptions(draft.apiFormat, value, modelCatalog)
          : model.reasoningOptions,
      };
    }));
    markProviderConfigurationChanged();
  }

  function updateDisplayName(modelDraftId: string, value: string): void {
    setConfiguredModelDrafts((current) => current.map((model) =>
      model.id === modelDraftId ? { ...model, displayName: value } : model,
    ));
    markProviderConfigurationChanged();
  }

  function addModel(): void {
    if (!isGlobalContextCompressionLoaded) return;
    const id = `model-${nextModelDraftIdRef.current++}`;
    setExpandedModelIds((current) => [...current, id]);
    newModelContextDefaultIdsRef.current.add(id);
    newModelReasoningDefaultIdsRef.current.add(id);
    setConfiguredModelDrafts((current) => [...current, {
      contextCompression: contextCompressionThreshold(globalContextCompressionRef.current),
      contextWindow: formatModelContextWindow(defaultModelContextWindow("", modelCatalog)),
      displayName: "",
      id,
      modelId: "",
      reasoningOptions: [],
    }]);
    setOperationError(null);
    markProviderConfigurationChanged();
  }

  function removeModel(modelDraftId: string): void {
    if (configuredModelDrafts.length === 1) {
      setOperationError("供应商至少保留一个模型");
      return;
    }
    newModelContextDefaultIdsRef.current.delete(modelDraftId);
    newModelReasoningDefaultIdsRef.current.delete(modelDraftId);
    setConfiguredModelDrafts((current) => current.filter((model) => model.id !== modelDraftId));
    setEditingReasoningModelId((current) => current === modelDraftId ? null : current);
    setOperationError(null);
    markProviderConfigurationChanged();
  }

  function markProviderConfigurationChanged(): void {
    setModelTestResults({});
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
    setProviderSaveState("pending");
  }

  function createProvider(): void {
    newProviderOwnerRef.current = {};
    setActiveProviderId(null);
    setIsApiKeyVisible(false);
    setDiscoveredModels([]);
    setProviderPage(0);
    setProviderSearchQuery("");
    setDraft({
      apiKey: "",
      apiFormat: DEFAULT_MODEL_API_FORMAT,
      baseUrl: "",
      providerIcon: "auto",
      providerName: "",
      providerNote: "",
      providerWebsiteUrl: "",
    });
    setConfiguredModelDrafts([]);
    setEditingReasoningModelId(null);
    setModelTestResults({});
    setOperationError(null);
    setProviderSaveState("idle");
  }

  async function deleteProvider(providerId: string): Promise<void> {
    if (pendingAutoSaveRef.current?.input?.providerId === providerId) {
      pendingAutoSaveRef.current = null;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    }
    setDeletingProviderId(providerId);
    setOperationError(null);
    try {
      const nextStatus = await saveQueue.deleteProvider(providerId);
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      if (selectedProviderId === providerId) {
        setProviderPage(0);
        setProviderSearchQuery("");
        const nextProvider = nextStatus.models[0]?.providerId;
        if (nextProvider === undefined) createProvider();
        else setActiveProviderId(nextProvider);
      }
    } catch (reason) {
      if (mountedRef.current) setOperationError(errorMessage(reason));
    } finally {
      if (mountedRef.current) setDeletingProviderId(null);
    }
  }

  async function discoverModels(): Promise<void> {
    if (draft.baseUrl.trim().length === 0 || draft.apiKey.trim().length === 0) {
      setOperationError("请先填写请求地址和 API Key");
      return;
    }
    setIsDiscovering(true);
    setOperationError(null);
    try {
      const models = await agentClient.discoverModels({
        apiKey: draft.apiKey,
        apiFormat: draft.apiFormat,
        baseUrl: draft.baseUrl,
      });
      setDiscoveredModels(models);
      try {
        setModelCatalog(await agentClient.getModelCatalog());
      } catch {
        setOperationError("模型目录配置格式错误，请检查 settings.jsonc 中的 modelCatalog");
      }
    } catch {
      setOperationError("获取模型失败，请检查接口地址、密钥和 OpenAI 兼容协议");
    } finally {
      setIsDiscovering(false);
    }
  }

  function openModelTestDialog(): void {
    setModelTestSelection(testableModels.map((model) => model.id));
    setIsModelTestDialogOpen(true);
  }

  function toggleModelTestSelection(modelId: string): void {
    setModelTestSelection((current) => current.includes(modelId)
      ? current.filter((candidate) => candidate !== modelId)
      : [...current, modelId]);
  }

  async function testModelConnection(modelId: string): Promise<void> {
    if (selectedProviderId === null || modelId.trim().length === 0) return;
    setModelTestResults((current) => ({ ...current, [modelId]: { kind: "testing" } }));
    try {
      const result = await agentClient.testModelConnection({
        modelId,
        providerId: selectedProviderId,
      });
      setStatus(rememberModelStatus(agentClient, await agentClient.getModelStatus()));
      setModelTestResults((current) => ({
        ...current,
        [modelId]: { content: result.content, kind: "success" },
      }));
    } catch (reason) {
      void loadModelStatus(agentClient).then(setStatus).catch(() => undefined);
      const message = getUserErrorMessage(reason, "模型没有返回有效回复");
      setModelTestResults((current) => ({
        ...current,
        [modelId]: { kind: "failed", message },
      }));
    }
  }

  async function testSelectedModels(): Promise<void> {
    if (selectedProviderId === null) return;
    const selectedModels = testableModels.filter((model) => modelTestSelection.includes(model.id));
    const firstModel = selectedModels.at(0);
    if (firstModel === undefined) return;
    setIsModelTestDialogOpen(false);
    setModelTestResults(Object.fromEntries(
      selectedModels.map((model) => [model.modelId, { kind: "testing" as const }]),
    ));
    for (let start = 0; start < selectedModels.length; start += MODEL_TEST_BATCH_SIZE) {
      const batch = selectedModels.slice(start, start + MODEL_TEST_BATCH_SIZE);
      await Promise.allSettled(batch.map((model) => testModelConnection(model.modelId)));
    }
  }

  async function setDefaultModel(model: ModelProfile): Promise<void> {
    setIsDefaultModelSaving(true);
    setOperationError(null);
    const pending = pendingAutoSaveRef.current;
    pendingAutoSaveRef.current = null;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    if (pending !== null) saveSnapshot(pending);
    const queuedSave = saveQueue.setDefaultModel({ modelId: model.modelId, providerId: model.providerId });
    try {
      const nextStatus = await queuedSave;
      if (mountedRef.current) setStatus(nextStatus);
    } catch {
      if (mountedRef.current) setOperationError("默认模型更新失败");
    } finally {
      if (mountedRef.current) setIsDefaultModelSaving(false);
    }
  }
  return {
    discoveredModels,
    setDiscoveredModels,
    draft,
    setDraft,
    setActiveProviderId,
    isDiscovering,
    isApiKeyVisible,
    setIsApiKeyVisible,
    configuredModelDrafts,
    setConfiguredModelDrafts,
    expandedModelIds,
    setExpandedModelIds,
    globalContextCompression,
    isGlobalContextCompressionLoaded,
    editingReasoningModelId,
    setEditingReasoningModelId,
    isDefaultModelSaving,
    isModelTestDialogOpen,
    setIsModelTestDialogOpen,
    modelTestSelection,
    setModelTestSelection,
    modelTestResults,
    operationError,
    setOperationError,
    setProviderPage,
    providerSaveState,
    deletingProviderId,
    providerSearchQuery,
    setProviderSearchQuery,
    modelCatalog,
    status,
    handleGlobalContextCompressionChange,
    providers,
    normalizedProviderSearchQuery,
    filteredProviders,
    providerPageCount,
    currentProviderPage,
    pagedProviders,
    selectedProviderId,
    savedProviderModels,
    hasValidConfiguredModels,
    testableModels,
    selectedTestableModelCount,
    isAnyModelTesting,
    updateDraft,
    setReasoningOptions,
    setContextWindow,
    setModelContextCompression,
    updateModelId,
    updateDisplayName,
    addModel,
    removeModel,
    markProviderConfigurationChanged,
    createProvider,
    deleteProvider,
    discoverModels,
    openModelTestDialog,
    toggleModelTestSelection,
    testModelConnection,
    testSelectedModels,
    setDefaultModel
  };
}

export type ModelSettingsController = ReturnType<typeof useModelSettingsController>;
