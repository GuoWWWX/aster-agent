import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Bot,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Eye,
  EyeOff,
  FileJson2,
  FolderOpen,
  KeyRound,
  ListTree,
  LoaderCircle,
  MessageSquareText,
  MonitorCog,
  PanelRight,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Terminal,
  TestTube2,
  Trash2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  ARCHIVED_CONVERSATION_RETENTION_DAYS,
  DEFAULT_MODEL_CATALOG,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  type ContextCompressionConfiguration,
  type ContextCompressionThreshold,
  type ConversationPermissionMode,
  type ConversationSummary,
  type DiscoveredModel,
  type ConfigurationScope,
  type IntegrationConfiguration,
  type McpServerConfiguration,
  type ModelApiFormat,
  type ModelCatalog,
  type ModelProfile,
  type ModelReasoningOption,
  type ModelRuntimeStatus,
  type ProjectSummary,
  type SaveModelConfigurationInput,
  type SkillConfiguration,
  type TerminalConfiguration,
  type TerminalOutputEncoding,
  type TerminalShell,
  type RuntimePlatform,
  type ApplicationPermissionPolicies,
  type PermissionPolicy,
  mcpServerConfigurationListSchema,
  mcpServerConfigurationSchema,
  isReasoningOptionEnabled,
  isReasoningOptionSupportedByApiFormat,
  integrationConfigurationSchema,
  modelReasoningOptionKey,
  terminalConfigurationSchema,
} from "@agent/protocol";

import { DocumentCodeEditor } from "../../components/editor/document-code-editor.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  useWorkbenchUiStore,
  type ThemeMode,
} from "../../stores/workbench-ui-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import { ModelReasoningOptionsEditor } from "./model-reasoning-options-editor.js";
import { ModelProfilePicker } from "./model-profile-picker.js";
import {
  getArchivedConversationDaysRemaining,
  getArchivedConversations,
} from "./archived-conversation-model.js";
import {
  defaultModelContextWindow,
  defaultReasoningOptions,
  reasoningOptionLabel,
} from "./model-reasoning-options.js";
import { AgentTeamSettings } from "./agent-team-settings.js";
import { useQueuedAutoSave, type AutoSaveState } from "./use-queued-auto-save.js";
import "./settings-workspace.css";

type SettingsSection =
  | "general"
  | "models"
  | "agents"
  | "mcp"
  | "skills"
  | "permissions"
  | "terminal"
  | "archived"
  | "appearance";

type PermissionRule = {
  action: string;
  id: keyof ApplicationPermissionPolicies;
  policy: PermissionPolicy;
  scope: string;
};

type ConfiguredProvider = {
  apiFormat: ModelApiFormat;
  baseUrl: string;
  connectionStatus: ModelProfile["connectionStatus"];
  id: string;
  name: string;
  note: string;
  websiteUrl: string;
};

type ActiveProviderId = string | null | undefined;

type ProviderSaveState = "idle" | "incomplete" | "pending" | "saving" | "saved";

type ModelTestState =
  | { kind: "idle" }
  | { kind: "testing"; modelId: string }
  | { content: string; kind: "success"; modelId: string }
  | { kind: "failed"; message: string; modelId: string };

type ConfiguredModelDraft = {
  contextCompression: ContextCompressionThreshold;
  contextWindow: string;
  displayName: string;
  id: string;
  modelId: string;
  reasoningOptions: ModelReasoningOption[];
};

type SettingsNavItem = {
  icon: LucideIcon;
  id: SettingsSection;
  label: string;
};

const SETTINGS_NAVIGATION: readonly SettingsNavItem[] = [
  { id: "general", label: "常规设置", icon: SlidersHorizontal },
  { id: "models", label: "模型配置", icon: Boxes },
  { id: "agents", label: "Agent 与团队", icon: UsersRound },
  { id: "mcp", label: "MCP", icon: PlugZap },
  { id: "skills", label: "Skill", icon: Sparkles },
  { id: "permissions", label: "权限", icon: ShieldCheck },
  { id: "terminal", label: "终端", icon: Terminal },
  { id: "archived", label: "已归档对话", icon: Archive },
  { id: "appearance", label: "外观", icon: MonitorCog },
];

const DEFAULT_MODEL_API_FORMAT: ModelApiFormat = "openai-chat-completions";
const PROVIDERS_PER_PAGE = 8;
const CONFIGURATIONS_PER_PAGE = 8;

const EMPTY_INTEGRATION_CONFIGURATION: IntegrationConfiguration = {
  mcpServers: [],
  skillDirectories: [],
  skills: [],
  version: 1,
};

const MODEL_API_FORMAT_OPTIONS: readonly { label: string; value: ModelApiFormat }[] = [
  { label: "OpenAI Chat Completions", value: "openai-chat-completions" },
  { label: "OpenAI Responses", value: "openai-responses" },
  { label: "Anthropic Messages", value: "anthropic-messages" },
  { label: "Google Gemini", value: "google-gemini" },
];

const TERMINAL_OUTPUT_ENCODING_OPTIONS: readonly {
  label: string;
  value: TerminalOutputEncoding;
}[] = [
  { label: "自动（UTF-8 / GB18030）", value: "auto" },
  { label: "UTF-8", value: "utf-8" },
  { label: "GBK", value: "gbk" },
  { label: "GB18030", value: "gb18030" },
  { label: "UTF-16 LE", value: "utf-16le" },
];

const PERMISSION_RULES: readonly Omit<PermissionRule, "policy">[] = [
  { id: "workspace-read", action: "工作区读取", scope: "已授权项目" },
  { id: "workspace-search", action: "代码搜索", scope: "已授权项目" },
  { id: "patch-write", action: "应用 Patch", scope: "目标文件" },
  { id: "command-run", action: "执行命令", scope: "工作目录" },
  { id: "git-write", action: "Git 写操作", scope: "所有项目" },
] as const;

export function SettingsWorkspace({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const permissionPolicies = useApplicationSettingsStore((state) => state.permissionPolicies);
  const setPermissionPolicy = useApplicationSettingsStore((state) => state.setPermissionPolicy);
  const permissions = useMemo(() => PERMISSION_RULES.map((permission) => ({
    ...permission,
    policy: permissionPolicies[permission.id],
  })), [permissionPolicies]);

  return (
    <section className="settings-workspace" aria-labelledby="settings-workspace-heading">
      <header className="workspace-page-header settings-workspace__header">
        <div className="settings-workspace__title-row">
          <h1 id="settings-workspace-heading">设置</h1>
          <p className="workspace-page-description settings-workspace__description">
            Agent、团队、模型、工具、权限、终端、对话和外观
          </p>
        </div>
        <span className="workspace-mode-badge">修改后自动保存</span>
      </header>

      <div className="settings-workspace__body">
        <nav className="settings-navigation" aria-label="设置分区">
          {SETTINGS_NAVIGATION.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeSection;

            return (
              <button
                key={item.id}
                aria-current={isActive ? "page" : undefined}
                className="settings-navigation__item"
                data-active={isActive}
                type="button"
                onClick={() => setActiveSection(item.id)}
              >
                <Icon aria-hidden="true" size={16} />
                <span>{item.label}</span>
                <ChevronRight aria-hidden="true" size={14} />
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {activeSection === "general" ? <GeneralSettings /> : null}
          {activeSection === "models" ? (
            <ModelsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "agents" ? <AgentTeamSettings /> : null}
          {activeSection === "mcp" ? (
            <McpSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "skills" ? (
            <SkillsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "permissions" ? (
            <PermissionsSettings
              permissions={permissions}
              onChange={setPermissionPolicy}
            />
          ) : null}
          {activeSection === "terminal" ? (
            <TerminalSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "archived" ? (
            <ArchivedConversationsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "appearance" ? <AppearanceSettings /> : null}
        </div>
      </div>
    </section>
  );
}

function GeneralSettings(): ReactElement {
  const defaultPermissionMode = useApplicationSettingsStore((state) => state.defaultPermissionMode);
  const defaultMessageDeliveryMode = useApplicationSettingsStore(
    (state) => state.defaultMessageDeliveryMode,
  );
  const setDefaultMessageDeliveryMode = useApplicationSettingsStore(
    (state) => state.setDefaultMessageDeliveryMode,
  );
  const setDefaultPermissionMode = useApplicationSettingsStore(
    (state) => state.setDefaultPermissionMode,
  );
  const sendShortcut = useApplicationSettingsStore((state) => state.sendShortcut);
  const setSendShortcut = useApplicationSettingsStore((state) => state.setSendShortcut);
  const showContextUsage = useApplicationSettingsStore((state) => state.showContextUsage);
  const setShowContextUsage = useApplicationSettingsStore((state) => state.setShowContextUsage);
  const filePanelOpen = useWorkbenchUiStore((state) => state.isFilePanelOpen);
  const projectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.isProjectNavigatorOpen,
  );
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setProjectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.setProjectNavigatorOpen,
  );

  return (
    <SettingsSectionHeader
      bodyClassName="settings-section__body--general"
      eyebrow="应用默认行为"
      title="常规设置"
    >
      <section className="settings-general-category" aria-labelledby="conversation-editor-heading">
        <h3 id="conversation-editor-heading">对话与编辑器</h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>显示上下文用量</h4>
              <p>在输入框右侧显示当前对话的上下文使用情况</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示上下文用量"
                checked={showContextUsage}
                type="checkbox"
                onChange={(event) => setShowContextUsage(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>发送快捷键</h4>
              <p>{sendShortcut === "enter" ? "按 Enter 发送，Shift+Enter 换行" : "按 Ctrl+Enter 发送，Enter 换行"}</p>
            </div>
            <div className="settings-segmented" role="group" aria-label="发送快捷键">
              <button
                aria-pressed={sendShortcut === "enter"}
                type="button"
                onClick={() => setSendShortcut("enter")}
              >
                Enter 发送
              </button>
              <button
                aria-pressed={sendShortcut === "ctrl_enter"}
                type="button"
                onClick={() => setSendShortcut("ctrl_enter")}
              >
                Ctrl+Enter 发送
              </button>
            </div>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>运行中消息投递</h4>
              <p>
                {defaultMessageDeliveryMode === "queue"
                  ? "默认加入待发送队列"
                  : "默认介入当前任务"}
              </p>
            </div>
            <div className="settings-segmented" role="group" aria-label="运行中消息默认投递方式">
              <button
                aria-pressed={defaultMessageDeliveryMode === "queue"}
                type="button"
                onClick={() => setDefaultMessageDeliveryMode("queue")}
              >
                排队
              </button>
              <button
                aria-pressed={defaultMessageDeliveryMode === "steer"}
                type="button"
                onClick={() => setDefaultMessageDeliveryMode("steer")}
              >
                直接
              </button>
            </div>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>新对话权限模式</h4>
              <p>新建对话时默认采用的文件与命令操作方式</p>
            </div>
            <Select
              value={defaultPermissionMode}
              onValueChange={(value) => setDefaultPermissionMode(value as ConversationPermissionMode)}
            >
              <SelectTrigger aria-label="新对话权限模式" className="settings-general-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="read_only">只读</SelectItem>
                <SelectItem value="ask_before_changes">修改前询问</SelectItem>
                <SelectItem value="full_access">完全访问</SelectItem>
              </SelectContent>
            </Select>
          </article>
        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="workspace-heading">
        <h3 id="workspace-heading">工作区</h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>对话列表</h4>
              <p>在左侧显示项目、置顶和临时对话</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示对话列表"
                checked={projectNavigatorOpen}
                type="checkbox"
                onChange={(event) => setProjectNavigatorOpen(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>右侧工作区</h4>
              <p>显示文件、终端和侧边对话标签</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示右侧工作区"
                checked={filePanelOpen}
                type="checkbox"
                onChange={(event) => setFilePanelOpen(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>
        </div>
      </section>
    </SettingsSectionHeader>
  );
}

function ModelsSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [draft, setDraft] = useState({
    apiKey: "",
    apiFormat: DEFAULT_MODEL_API_FORMAT,
    baseUrl: "",
    providerName: "",
    providerNote: "",
    providerWebsiteUrl: "",
  });
  // undefined means the saved default has not been resolved yet; null is an explicit new-provider draft.
  const [activeProviderId, setActiveProviderId] = useState<ActiveProviderId>(undefined);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [configuredModelDrafts, setConfiguredModelDrafts] = useState<ConfiguredModelDraft[]>([]);
  const [globalContextCompression, setGlobalContextCompression] = useState<ContextCompressionConfiguration>(
    DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  );
  const [isGlobalContextCompressionLoaded, setIsGlobalContextCompressionLoaded] = useState(false);
  const [editingReasoningModelId, setEditingReasoningModelId] = useState<string | null>(null);
  const [isDefaultModelSaving, setIsDefaultModelSaving] = useState(false);
  const [modelTestState, setModelTestState] = useState<ModelTestState>({ kind: "idle" });
  const [operationError, setOperationError] = useState<string | null>(null);
  const [providerPage, setProviderPage] = useState(0);
  const [providerSaveState, setProviderSaveState] = useState<ProviderSaveState>("idle");
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [saveRevision, setSaveRevision] = useState(0);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>(DEFAULT_MODEL_CATALOG);
  const [status, setStatus] = useState<ModelRuntimeStatus | null>(null);
  const autoSaveInputRef = useRef<SaveModelConfigurationInput | null>(null);
  const handledSaveRevisionRef = useRef(0);
  const latestSaveRevisionRef = useRef(0);
  const selectedProviderIdRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nextModelDraftIdRef = useRef(1);
  const newModelContextDefaultIdsRef = useRef(new Set<string>());
  const newModelReasoningDefaultIdsRef = useRef(new Set<string>());
  const globalContextCompressionRef = useRef(globalContextCompression);

  const handleGlobalContextCompressionChange = useCallback((configuration: ContextCompressionConfiguration) => {
    globalContextCompressionRef.current = configuration;
    setGlobalContextCompression(configuration);
    setIsGlobalContextCompressionLoaded(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    void agentClient
      .getModelStatus()
      .then((nextStatus) => {
        if (disposed) return;
        setStatus(nextStatus);
        setActiveProviderId((current) => current === undefined
          ? nextStatus.providerId ?? getConfiguredProviders(nextStatus.models)[0]?.id ?? null
          : current);
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取已保存的模型配置");
      });
    return () => {
      disposed = true;
    };
  }, [agentClient]);

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
    new Set(normalizedModelIds).size === normalizedModelIds.length;

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
            contextCompression: model.contextCompression,
            contextWindow: Math.max(
              0,
              Number(model.contextWindow) || 0,
            ),
            displayName: model.displayName.trim(),
            modelId: model.modelId.trim(),
            reasoningOptions: model.reasoningOptions,
          })),
          ...(selectedProviderId === null ? {} : { providerId: selectedProviderId }),
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

  useEffect(() => {
    if (saveRevision === 0 || handledSaveRevisionRef.current === saveRevision) {
      return;
    }
    handledSaveRevisionRef.current = saveRevision;
    const revision = saveRevision;
    const input = autoSaveInputRef.current;
    const timer = window.setTimeout(() => {
      if (input === null) {
        setProviderSaveState("incomplete");
        return;
      }
      setProviderSaveState("saving");
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const nextStatus = await agentClient.saveModelConfiguration(input);
          setStatus(nextStatus);
          if (selectedProviderIdRef.current === null) {
            const savedProviderId = nextStatus.models.find((model) =>
              model.providerName === input.providerName &&
              model.modelId === input.models[0]?.modelId
            )?.providerId;
            if (savedProviderId !== undefined) setActiveProviderId(savedProviderId);
          }
          if (latestSaveRevisionRef.current === revision) {
            setOperationError(null);
            setProviderSaveState("saved");
          }
        })
        .catch(() => {
          if (latestSaveRevisionRef.current === revision) {
            setOperationError("模型配置更新失败");
            setProviderSaveState("idle");
          }
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [agentClient, saveRevision]);

  useEffect(() => {
    if (!isGlobalContextCompressionLoaded) return;
    const provider = activeProviderRef.current;
    if (provider === null) return;
    let disposed = false;
    const providerModels = savedProviderModelsRef.current;
    const modelDrafts = providerModels.map((model) => ({
      contextCompression: model.contextCompression
        ?? contextCompressionThreshold(globalContextCompressionRef.current),
      contextWindow: String(model.contextWindow),
      displayName: model.displayName,
      id: `model-${nextModelDraftIdRef.current++}`,
      modelId: model.modelId,
      reasoningOptions: model.reasoningOptions,
    }));
    setDraft({
      apiKey: "",
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      providerName: provider.name,
      providerNote: provider.note,
      providerWebsiteUrl: provider.websiteUrl,
    });
    setConfiguredModelDrafts(modelDrafts);
    setEditingReasoningModelId(null);
    setModelTestState({ kind: "idle" });

    void agentClient
      .getModelApiKey(provider.id)
      .then((apiKey) => {
        if (disposed) return;
        setDraft((current) => ({ ...current, apiKey: apiKey ?? "" }));
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取已保存的供应商配置");
      });

    return () => {
      disposed = true;
    };
  }, [activeProviderId, agentClient, isGlobalContextCompressionLoaded]);

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
    const shouldApplyReasoningDefaults = newModelReasoningDefaultIdsRef.current.has(modelDraftId);
    const shouldApplyContextWindowDefault = newModelContextDefaultIdsRef.current.has(modelDraftId);
    setConfiguredModelDrafts((current) => current.map((model) => {
      if (model.id !== modelDraftId) return model;
      return {
        ...model,
        contextWindow: shouldApplyContextWindowDefault
          ? String(defaultModelContextWindow(value, modelCatalog))
          : model.contextWindow,
        displayName: model.displayName.length === 0 || model.displayName === model.modelId
          ? value
          : model.displayName,
        modelId: value,
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
    newModelContextDefaultIdsRef.current.add(id);
    newModelReasoningDefaultIdsRef.current.add(id);
    setConfiguredModelDrafts((current) => [...current, {
      contextCompression: contextCompressionThreshold(globalContextCompressionRef.current),
      contextWindow: String(defaultModelContextWindow("", modelCatalog)),
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
    setModelTestState({ kind: "idle" });
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
    setProviderSaveState("pending");
  }

  function createProvider(): void {
    setActiveProviderId(null);
    setIsApiKeyVisible(false);
    setDiscoveredModels([]);
    setProviderPage(0);
    setProviderSearchQuery("");
    setDraft({
      apiKey: "",
      apiFormat: DEFAULT_MODEL_API_FORMAT,
      baseUrl: "",
      providerName: "",
      providerNote: "",
      providerWebsiteUrl: "",
    });
    setConfiguredModelDrafts([]);
    setEditingReasoningModelId(null);
    setModelTestState({ kind: "idle" });
    setOperationError(null);
    setProviderSaveState("idle");
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
        setOperationError("模型目录配置格式错误，请检查 model-catalog.json");
      }
    } catch {
      setOperationError("获取模型失败，请检查接口地址、密钥和 OpenAI 兼容协议");
    } finally {
      setIsDiscovering(false);
    }
  }

  async function testModelConnection(modelId: string): Promise<void> {
    if (selectedProviderId === null || modelId.trim().length === 0) return;
    setModelTestState({ kind: "testing", modelId });
    try {
      const result = await agentClient.testModelConnection({
        modelId,
        providerId: selectedProviderId,
      });
      setStatus(await agentClient.getModelStatus());
      setModelTestState({ content: result.content, kind: "success", modelId: result.modelId });
    } catch (reason) {
      void agentClient.getModelStatus().then(setStatus).catch(() => undefined);
      setModelTestState({
        kind: "failed",
        message: getUserErrorMessage(reason, "模型没有返回有效回复"),
        modelId,
      });
    }
  }

  async function setDefaultModel(model: ModelProfile): Promise<void> {
    setIsDefaultModelSaving(true);
    setOperationError(null);
    const queuedSave = saveQueueRef.current
      .catch(() => undefined)
      .then(() => agentClient.setDefaultModel({
        modelId: model.modelId,
        providerId: model.providerId,
      }));
    saveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
    try {
      setStatus(await queuedSave);
    } catch {
      setOperationError("默认模型更新失败");
    } finally {
      setIsDefaultModelSaving(false);
    }
  }

  return (
    <SettingsSectionHeader
      bodyClassName="settings-section__body--models"
      eyebrow="模型协议 · 供应商"
      title="模型配置"
    >
      <GlobalDefaultsSettings
        agentClient={agentClient}
        onContextCompressionChange={handleGlobalContextCompressionChange}
        defaultModelPicker={
          <GlobalDefaultModelPicker
            defaultContextCompression={globalContextCompression}
            disabled={isDefaultModelSaving}
            models={status?.models ?? []}
            selectedModelId={status?.modelId ?? null}
            selectedProviderId={status?.providerId ?? null}
            onSelect={(model) => void setDefaultModel(model)}
          />
        }
      />
      <div className="settings-provider-manager">
        <aside className="settings-provider-list" aria-label="供应商列表">
          <header className="settings-provider-list__heading">
            <strong>供应商</strong>
            <button
              className="settings-primary-button settings-provider-list__add"
              type="button"
              onClick={createProvider}
            >
              <CirclePlus aria-hidden="true" size={15} />
              添加供应商
            </button>
          </header>

          <div className="settings-provider-list__body">
            <label className="settings-provider-list__search app-search-field">
              <Search aria-hidden="true" size={14} />
              <input
                aria-label="搜索供应商"
                autoComplete="off"
                placeholder="搜索供应商"
                value={providerSearchQuery}
                onChange={(event) => {
                  setProviderSearchQuery(event.target.value);
                  setProviderPage(0);
                }}
              />
            </label>

            <div className="settings-provider-list__items">
              {pagedProviders.length === 0 ? (
                <p className="settings-provider-list__empty">
                  {normalizedProviderSearchQuery.length === 0 ? "暂无已配置供应商" : "未找到匹配的供应商"}
                </p>
              ) : pagedProviders.map((provider) => (
                <button
                  key={provider.id}
                  aria-pressed={provider.id === selectedProviderId}
                  className="settings-provider-list__item"
                  data-active={provider.id === selectedProviderId}
                  type="button"
                  onClick={() => {
                    setActiveProviderId(provider.id);
                    setIsApiKeyVisible(false);
                    setDiscoveredModels([]);
                    setOperationError(null);
                  }}
                >
                  <span className="settings-provider-list__icon"><Bot aria-hidden="true" size={16} /></span>
                  <span className="settings-provider-list__identity">
                    <strong>{provider.name}</strong>
                    <small>{provider.baseUrl}</small>
                  </span>
                  <span
                    aria-label={connectionStatusLabel(provider.connectionStatus)}
                    className="settings-provider-list__status"
                    data-state={provider.connectionStatus}
                  />
                </button>
              ))}
            </div>
          </div>

          <footer className="settings-provider-list__pagination">
            <span className="settings-provider-list__count">
              {normalizedProviderSearchQuery.length === 0
                ? `共 ${providers.length} 家供应商`
                : `匹配 ${filteredProviders.length} / ${providers.length} 家`}
            </span>
            <div className="settings-provider-list__pagination-controls" aria-label="供应商分页">
              <button
                aria-label="上一页"
                disabled={currentProviderPage === 0}
                title="上一页"
                type="button"
                onClick={() => setProviderPage(Math.max(0, currentProviderPage - 1))}
              >
                <ChevronLeft aria-hidden="true" size={14} />
              </button>
              <span aria-label={`第 ${currentProviderPage + 1} 页，共 ${providerPageCount} 页`}>
                {currentProviderPage + 1} / {providerPageCount}
              </span>
              <button
                aria-label="下一页"
                disabled={currentProviderPage >= providerPageCount - 1}
                title="下一页"
                type="button"
                onClick={() => setProviderPage(Math.min(providerPageCount - 1, currentProviderPage + 1))}
              >
                <ChevronRight aria-hidden="true" size={14} />
              </button>
            </div>
          </footer>
        </aside>

        <div className="settings-provider-editor">
          <header className="settings-provider-editor__header">
            <div>
              <h3>{draft.providerName.trim() || "新供应商"}</h3>
            </div>
            <span
              className="settings-state-badge"
              data-state={selectedProviderId === null ? "offline" : "ready"}
            >
              {selectedProviderId === null ? "未保存" : "已配置"}
            </span>
          </header>

          <div className="settings-provider-fields">
            <label>
              供应商名称
              <input
                name="providerName"
                placeholder="例如：OpenAI、DeepSeek"
                value={draft.providerName}
                onChange={updateDraft}
              />
            </label>
            <label>
              备注
              <input
                maxLength={500}
                name="providerNote"
                placeholder="填写供应商备注"
                value={draft.providerNote}
                onChange={updateDraft}
              />
            </label>
            <label>
              官网地址
              <input
                name="providerWebsiteUrl"
                placeholder="https://example.com"
                type="url"
                value={draft.providerWebsiteUrl}
                onChange={updateDraft}
              />
            </label>
            <label>
              API 格式
              <Select
                value={draft.apiFormat}
                onValueChange={(value) => {
                  const apiFormat = value as ModelApiFormat;
                  setDraft((current) => ({ ...current, apiFormat }));
                  setConfiguredModelDrafts((current) => current.map((model) => ({
                    ...model,
                    reasoningOptions: model.reasoningOptions.filter((option) =>
                      isReasoningOptionSupportedByApiFormat(apiFormat, option, model.modelId)
                    ),
                  })));
                  markProviderConfigurationChanged();
                }}
              >
                <SelectTrigger aria-label="API 格式" className="settings-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {MODEL_API_FORMAT_OPTIONS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="settings-provider-fields__credentials">
              <label>
                请求地址
                <input
                  name="baseUrl"
                  placeholder={modelApiBaseUrlPlaceholder(draft.apiFormat)}
                  value={draft.baseUrl}
                  onChange={updateDraft}
                />
              </label>
              <label>
                API Key
                <div className="settings-secret-input">
                  <input
                    autoComplete="off"
                    name="apiKey"
                    placeholder="请输入 API Key"
                    type={isApiKeyVisible ? "text" : "password"}
                    value={draft.apiKey}
                    onChange={updateDraft}
                  />
                  <button
                    aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                    title={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                    type="button"
                    onClick={() => setIsApiKeyVisible((current) => !current)}
                  >
                    {isApiKeyVisible ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
                  </button>
                </div>
              </label>
            </div>
          </div>

          <section className="settings-provider-models" aria-labelledby="provider-models-heading">
            <div className="settings-provider-models__heading">
              <div className="settings-provider-models__heading-copy">
                <h4 id="provider-models-heading">已配置模型</h4>
                <p>请求使用模型 ID；显示名只用于对话界面。</p>
              </div>
              <div className="settings-provider-models__heading-actions">
                <button
                  className="settings-secondary-button"
                  disabled={isDiscovering || providerSaveState === "saving"}
                  type="button"
                  onClick={() => void discoverModels()}
                >
                  <RefreshCw aria-hidden="true" className={isDiscovering ? "settings-spin" : undefined} size={15} />
                  获取模型
                </button>
                <button
                  className="settings-secondary-button"
                  disabled={!isGlobalContextCompressionLoaded}
                  title={isGlobalContextCompressionLoaded ? undefined : "正在读取全局配置"}
                  type="button"
                  onClick={addModel}
                >
                  <CirclePlus aria-hidden="true" size={15} />
                  添加模型
                </button>
              </div>
            </div>

            {configuredModelDrafts.length > 0 ? (
              <div className="settings-model-list" role="list" aria-label="供应商模型">
                {configuredModelDrafts.map((model) => {
                  const isEditingReasoning = editingReasoningModelId === model.id;
                  const isTestingModel = modelTestState.kind === "testing" && modelTestState.modelId === model.modelId;
                  const connectionStatus = savedProviderModels.find((candidate) =>
                    candidate.modelId === model.modelId
                  )?.connectionStatus ?? "unknown";
                  const enabledReasoningOptions = model.reasoningOptions.filter(isReasoningOptionEnabled);
                  const reasoningSummary = enabledReasoningOptions.length === 0
                    ? "自动"
                    : enabledReasoningOptions.map(reasoningOptionLabel).join("，");
                  return (
                    <div
                      key={model.id}
                      className="settings-model-option"
                      role="listitem"
                    >
                      <label className="settings-model-field settings-model-field--name">
                        <span
                          aria-label={connectionStatusLabel(connectionStatus)}
                          className="settings-model-connection-status"
                          data-state={connectionStatus}
                          title={connectionStatusLabel(connectionStatus)}
                        />
                        <input
                          aria-label={`${model.modelId || "模型"}的模型名称`}
                          placeholder="模型名称"
                          value={model.displayName}
                          onChange={(event) => updateDisplayName(model.id, event.target.value)}
                        />
                      </label>

                      <div className="settings-model-field settings-model-field--id">
                        <ModelIdPicker
                          discoveredModels={discoveredModels}
                          modelId={model.modelId}
                          onValueChange={(value) => updateModelId(model.id, value)}
                        />
                      </div>

                      <Popover
                        open={isEditingReasoning}
                        onOpenChange={(nextOpen) => {
                          setEditingReasoningModelId((current) => (
                            nextOpen ? model.id : current === model.id ? null : current
                          ));
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            aria-controls={`model-reasoning-options-${model.id}`}
                            aria-label={`${model.modelId || "模型"}的已启用推理强度：${reasoningSummary}`}
                            className="settings-model-reasoning-button"
                            type="button"
                          >
                            <ReasoningOptionsSummary options={enabledReasoningOptions} />
                            <ChevronDown aria-hidden="true" size={14} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          className="settings-model-reasoning-popover"
                          id={`model-reasoning-options-${model.id}`}
                          side="bottom"
                        >
                          <ModelReasoningOptionsEditor
                            apiFormat={draft.apiFormat}
                            modelId={model.modelId}
                            modelName={model.displayName || model.modelId || "此模型"}
                            options={model.reasoningOptions}
                            onChange={(reasoningOptions) => setReasoningOptions(model.id, reasoningOptions)}
                          />
                        </PopoverContent>
                      </Popover>

                      <div className="settings-model-context-controls">
                        <label className="settings-model-field settings-model-field--context">
                          <input
                            aria-label={`${model.modelId || "模型"}的上下文窗口`}
                            max="10000000"
                            min="0"
                            placeholder="上下文窗口"
                            type="number"
                            value={model.contextWindow}
                            onChange={(event) => setContextWindow(model.id, event.target.value)}
                          />
                        </label>

                        <ModelContextCompressionEditor
                          configuration={model.contextCompression}
                          editorId={model.id}
                          modelName={model.displayName || model.modelId || "此模型"}
                          onChange={(contextCompression) =>
                            setModelContextCompression(model.id, contextCompression)
                          }
                        />
                      </div>

                      <div className="settings-model-actions">
                        <button
                          aria-label={`测试 ${model.displayName || model.modelId || "模型"}`}
                          className="settings-model-test"
                          disabled={
                            selectedProviderId === null ||
                            model.modelId.trim().length === 0 ||
                            providerSaveState === "pending" ||
                            providerSaveState === "saving" ||
                            providerSaveState === "incomplete" ||
                            modelTestState.kind === "testing"
                          }
                          title="连通测试"
                          type="button"
                          onClick={() => void testModelConnection(model.modelId)}
                        >
                          {isTestingModel
                            ? <LoaderCircle aria-hidden="true" className="settings-spin" size={15} />
                            : <TestTube2 aria-hidden="true" size={15} />}
                        </button>
                        <button
                          aria-label={`删除 ${model.displayName || model.modelId || "模型"}`}
                          className="settings-model-delete"
                          disabled={configuredModelDrafts.length === 1}
                          title={configuredModelDrafts.length === 1 ? "供应商至少保留一个模型" : "删除模型"}
                          type="button"
                          onClick={() => removeModel(model.id)}
                        >
                          <Trash2 aria-hidden="true" size={16} />
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="settings-empty-state">添加模型后输入模型 ID；获取模型后可从右侧下拉选择。</p>
            )}

          </section>

          {modelTestState.kind !== "idle" ? (
            <p
              className="settings-model-test-result"
              data-state={modelTestState.kind}
              role={modelTestState.kind === "failed" ? "alert" : "status"}
            >
              {modelTestState.kind === "testing" ? (
                <><LoaderCircle aria-hidden="true" className="settings-spin" size={14} />正在向 {modelTestState.modelId} 发送 hi! 测试请求</>
              ) : null}
              {modelTestState.kind === "success" ? (
                <><Check aria-hidden="true" size={14} />{modelTestState.modelId} 连接正常：{modelTestState.content}</>
              ) : null}
              {modelTestState.kind === "failed" ? (
                <>{modelTestState.modelId} 测试失败：{modelTestState.message}</>
              ) : null}
            </p>
          ) : null}

          {operationError !== null ? <p className="settings-operation-error" role="alert">{operationError}</p> : null}

          <footer className="settings-provider-editor__footer">
            <p>
              {providerSaveState === "pending"
                ? "等待更新"
                : providerSaveState === "saving"
                  ? "正在更新"
                  : providerSaveState === "saved"
                    ? "已更新"
                    : providerSaveState === "incomplete"
                      ? "请完成供应商和模型配置"
                      : status?.configured
                        ? `已配置 ${providers.length} 家供应商、${status.models.length} 个模型`
                        : "填写供应商和模型配置"}
            </p>
          </footer>
        </div>
      </div>
    </SettingsSectionHeader>
  );
}

function ReasoningOptionsSummary({
  options,
}: {
  options: readonly ModelReasoningOption[];
}): ReactElement {
  const valueRef = useRef<HTMLSpanElement>(null);
  const tagMeasurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const overflowMeasurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState(options.length);

  const recalculateVisibleCount = useCallback((): void => {
    const valueElement = valueRef.current;
    if (valueElement === null || options.length === 0) return;

    const availableWidth = valueElement.getBoundingClientRect().width;
    const tagWidths = options.map((_, index) =>
      tagMeasurementRefs.current.get(index)?.getBoundingClientRect().width ?? 0,
    );
    if (availableWidth === 0 || tagWidths.some((width) => width === 0)) return;

    const styles = window.getComputedStyle(valueElement);
    const gap = Number.parseFloat(styles.columnGap) || Number.parseFloat(styles.gap) || 0;
    let nextVisibleCount = 0;

    for (let count = options.length; count >= 0; count -= 1) {
      const hiddenCount = options.length - count;
      const widths = tagWidths.slice(0, count);
      if (hiddenCount > 0) {
        const overflowWidth = overflowMeasurementRefs.current
          .get(hiddenCount)
          ?.getBoundingClientRect().width ?? 0;
        if (overflowWidth === 0) continue;
        widths.push(overflowWidth);
      }
      const requiredWidth = widths.reduce((total, width) => total + width, 0)
        + Math.max(0, widths.length - 1) * gap;
      if (requiredWidth <= availableWidth + 0.5) {
        nextVisibleCount = count;
        break;
      }
    }

    setVisibleCount((current) => current === nextVisibleCount ? current : nextVisibleCount);
  }, [options]);

  useLayoutEffect(() => {
    recalculateVisibleCount();
    const valueElement = valueRef.current;
    if (valueElement === null || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(recalculateVisibleCount);
    observer.observe(valueElement);
    return () => observer.disconnect();
  }, [recalculateVisibleCount]);

  if (options.length === 0) {
    return (
      <span
        ref={valueRef}
        className="settings-model-reasoning-button__value"
        data-empty="true"
      >
        <span className="settings-model-reasoning-button__placeholder">自动</span>
      </span>
    );
  }

  const displayedCount = Math.min(visibleCount, options.length);
  const hiddenCount = options.length - displayedCount;
  const summary = options.map(reasoningOptionLabel).join("，");

  return (
    <>
      <span
        ref={valueRef}
        className="settings-model-reasoning-button__value"
        title={summary}
      >
        {options.slice(0, displayedCount).map((option) => (
          <span
            key={modelReasoningOptionKey(option)}
            className="settings-model-reasoning-button__tag"
            title={reasoningOptionLabel(option)}
          >
            {reasoningOptionLabel(option)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="settings-model-reasoning-button__more">+{hiddenCount}</span>
        ) : null}
      </span>
      <span aria-hidden="true" className="settings-model-reasoning-button__measure">
        {options.map((option, index) => (
          <span
            key={modelReasoningOptionKey(option)}
            ref={(element) => {
              if (element === null) tagMeasurementRefs.current.delete(index);
              else tagMeasurementRefs.current.set(index, element);
            }}
            className="settings-model-reasoning-button__tag"
          >
            {reasoningOptionLabel(option)}
          </span>
        ))}
        {options.map((_, index) => {
          const count = options.length - index;
          return (
            <span
              key={count}
              ref={(element) => {
                if (element === null) overflowMeasurementRefs.current.delete(count);
                else overflowMeasurementRefs.current.set(count, element);
              }}
              className="settings-model-reasoning-button__more"
            >
              +{count}
            </span>
          );
        })}
      </span>
    </>
  );
}

function getConfiguredProviders(models: readonly ModelProfile[]): ConfiguredProvider[] {
  const providers = new Map<string, ConfiguredProvider>();
  for (const model of models) {
    if (!providers.has(model.providerId)) {
      providers.set(model.providerId, {
        apiFormat: model.providerApiFormat,
        baseUrl: model.providerBaseUrl,
        connectionStatus: model.connectionStatus,
        id: model.providerId,
        name: model.providerName,
        note: model.providerNote ?? "",
        websiteUrl: model.providerWebsiteUrl ?? "",
      });
    } else {
      const provider = providers.get(model.providerId);
      if (provider !== undefined) {
        provider.connectionStatus = mergeConnectionStatus(provider.connectionStatus, model.connectionStatus);
      }
    }
  }
  return [...providers.values()];
}

function mergeConnectionStatus(
  current: ModelProfile["connectionStatus"],
  next: ModelProfile["connectionStatus"],
): ModelProfile["connectionStatus"] {
  if (current === "error" || next === "error") return "error";
  if (current === "healthy" || next === "healthy") return "healthy";
  return "unknown";
}

function connectionStatusLabel(status: ModelProfile["connectionStatus"]): string {
  if (status === "healthy") return "连接正常";
  if (status === "error") return "连接异常";
  return "未测试";
}

function isOptionalUrlValid(value: string): boolean {
  if (value.trim().length === 0) return true;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

function contextCompressionThreshold(
  configuration: ContextCompressionConfiguration | ContextCompressionThreshold,
): ContextCompressionThreshold {
  return {
    mode: configuration.mode,
    percentageThreshold: configuration.percentageThreshold,
    tokenThreshold: configuration.tokenThreshold,
  };
}

function contextCompressionThresholdLabel(configuration: ContextCompressionThreshold): string {
  return configuration.mode === "percentage"
    ? `${configuration.percentageThreshold}%`
    : `${configuration.tokenThreshold.toLocaleString("en-US")} Token`;
}

function compactTokenCount(tokenCount: number): string {
  if (tokenCount < 1_000) return String(tokenCount);
  const divisor = tokenCount >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? "M" : "K";
  const value = tokenCount / divisor;
  const precision = value >= 10 ? 1 : 2;
  return `${Number(value.toFixed(precision))}${suffix}`;
}

function contextCompressionThresholdButtonLabel(configuration: ContextCompressionThreshold): string {
  return configuration.mode === "percentage"
    ? `${configuration.percentageThreshold}%`
    : compactTokenCount(configuration.tokenThreshold);
}

function GlobalDefaultsSettings({
  agentClient,
  defaultModelPicker,
  onContextCompressionChange,
}: {
  agentClient: AgentClient;
  defaultModelPicker: ReactNode;
  onContextCompressionChange: (configuration: ContextCompressionConfiguration) => void;
}): ReactElement {
  return (
    <section className="settings-global-configuration" aria-labelledby="global-defaults-heading">
      <header className="settings-global-configuration__heading">
        <h3 id="global-defaults-heading">全局配置</h3>
      </header>
      <div className="settings-global-configuration__body">
        {defaultModelPicker}
        <ContextCompressionSettings
          agentClient={agentClient}
          onConfigurationChange={onContextCompressionChange}
        />
      </div>
    </section>
  );
}

function ModelContextCompressionEditor({
  configuration,
  editorId,
  modelName,
  onChange,
}: {
  configuration: ContextCompressionThreshold;
  editorId: string;
  modelName: string;
  onChange: (configuration: ContextCompressionThreshold) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const isPercentage = configuration.mode === "percentage";
  const activeThreshold = isPercentage
    ? configuration.percentageThreshold
    : configuration.tokenThreshold;
  const thresholdLabel = isPercentage ? "压缩阈值 (%)" : "压缩阈值 (Token)";

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          aria-controls={`model-context-compression-${editorId}`}
          aria-label={`${modelName}的上下文自动压缩阈值：${contextCompressionThresholdLabel(configuration)}`}
          className="settings-model-compression-button"
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={14} />
          <span className="settings-model-compression-button__value">
            {contextCompressionThresholdButtonLabel(configuration)}
          </span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="settings-model-compression-popover"
        id={`model-context-compression-${editorId}`}
        side="bottom"
      >
        <div className="settings-model-compression-editor">
          <header>
            <strong>压缩阈值</strong>
          </header>
          <div className="settings-model-compression-editor__controls">
            <div className="settings-model-compression-editor__mode" aria-label={`${modelName}的压缩阈值模式`}>
              <button
                aria-pressed={!isPercentage}
                data-active={!isPercentage}
                type="button"
                onClick={() => {
                  if (!isPercentage) return;
                  onChange({ ...configuration, mode: "tokens" });
                }}
              >
                Token
              </button>
              <button
                aria-pressed={isPercentage}
                data-active={isPercentage}
                type="button"
                onClick={() => {
                  if (isPercentage) return;
                  onChange({ ...configuration, mode: "percentage" });
                }}
              >
                百分比
              </button>
            </div>
            <label className="settings-model-compression-editor__threshold">
              <span>{thresholdLabel}</span>
              <input
                aria-label={`${modelName}的${thresholdLabel}`}
                max={isPercentage ? 100 : 10_000_000}
                min="1"
                inputMode="numeric"
                type="number"
                value={String(activeThreshold)}
                onChange={(event) => {
                  const threshold = Number(event.target.value);
                  if (!Number.isInteger(threshold) || threshold < 1) return;
                  const cappedThreshold = Math.min(threshold, isPercentage ? 100 : 10_000_000);
                  onChange(isPercentage
                    ? { ...configuration, percentageThreshold: cappedThreshold }
                    : { ...configuration, tokenThreshold: cappedThreshold },
                  );
                }}
              />
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GlobalDefaultModelPicker({
  defaultContextCompression,
  disabled,
  models,
  selectedModelId,
  selectedProviderId,
  onSelect,
}: {
  defaultContextCompression: ContextCompressionThreshold;
  disabled: boolean;
  models: readonly ModelProfile[];
  selectedModelId: string | null;
  selectedProviderId: string | null;
  onSelect: (model: ModelProfile) => void;
}): ReactElement {
  const selectedModel = models.find((model) =>
    model.providerId === selectedProviderId && model.modelId === selectedModelId
  );

  return (
    <div className="settings-global-model">
      <div className="settings-global-model__heading">
        <span>默认模型</span>
        <small>新对话使用</small>
      </div>

      <ModelProfilePicker
        ariaLabel="默认模型列表"
        defaultContextCompression={defaultContextCompression}
        models={models}
        selectedModelId={selectedModelId}
        selectedProviderId={selectedProviderId}
        trigger={
          <button
            aria-label="选择默认模型"
            className="settings-global-model__trigger"
            data-empty={selectedModel === undefined}
            disabled={disabled || models.length === 0}
            title={selectedModel === undefined ? "请先配置供应商模型" : "选择默认模型"}
            type="button"
          >
            <Bot aria-hidden="true" size={16} />
            <span className="settings-global-model__selection">
              <strong>
                {selectedModel === undefined
                  ? "选择默认模型"
                  : `${selectedModel.providerName} · ${selectedModel.displayName}`}
              </strong>
              <small>{selectedModel?.modelId ?? "先配置供应商模型"}</small>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        }
        onSelect={onSelect}
      />
    </div>
  );
}

function ContextCompressionSettings({
  agentClient,
  onConfigurationChange,
}: {
  agentClient: AgentClient;
  onConfigurationChange: (configuration: ContextCompressionConfiguration) => void;
}): ReactElement {
  const [configuration, setConfiguration] = useState<ContextCompressionConfiguration>(
    DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "failed">("idle");
  const [thresholdInput, setThresholdInput] = useState("80");
  const configurationRef = useRef(configuration);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRevisionRef = useRef(0);

  useEffect(() => {
    configurationRef.current = configuration;
  }, [configuration]);

  useEffect(() => {
    let disposed = false;
    void agentClient.getContextCompressionConfiguration().then(
      (nextConfiguration) => {
        if (disposed) return;
        setConfiguration(nextConfiguration);
        onConfigurationChange(nextConfiguration);
        setThresholdInput(String(
          nextConfiguration.mode === "percentage"
            ? nextConfiguration.percentageThreshold
            : nextConfiguration.tokenThreshold,
        ));
        setIsLoaded(true);
      },
      () => {
        if (disposed) return;
        onConfigurationChange(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
        setIsLoaded(true);
        setSaveState("failed");
      },
    );
    return () => {
      disposed = true;
    };
  }, [agentClient, onConfigurationChange]);

  useEffect(() => {
    if (!isLoaded || saveRevision === 0) return undefined;
    const revision = saveRevision;
    const configurationToSave = configurationRef.current;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await agentClient.saveContextCompressionConfiguration(configurationToSave);
          if (latestSaveRevisionRef.current === revision) {
            setConfiguration(saved);
            onConfigurationChange(saved);
            setSaveState("saved");
          }
        })
        .catch(() => {
          if (latestSaveRevisionRef.current === revision) setSaveState("failed");
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [agentClient, isLoaded, onConfigurationChange, saveRevision]);

  function updateConfiguration(nextConfiguration: ContextCompressionConfiguration): void {
    setConfiguration(nextConfiguration);
    onConfigurationChange(nextConfiguration);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
    setSaveState("pending");
  }

  const isPercentage = configuration.mode === "percentage";
  const thresholdLabel = isPercentage ? "压缩阈值 (%)" : "压缩阈值 (tokens)";

  return (
    <div className="settings-context-compression">
      <div className="settings-context-compression__heading">
        <span>上下文自动压缩</span>
        <small>
          {isPercentage ? "按模型窗口计算" : "按已占用 Token 计算"}
        </small>
      </div>
      <div className="settings-context-compression__controls">
        <div className="settings-context-compression__mode" aria-label="压缩阈值模式">
          <button
            aria-pressed={!isPercentage}
            data-active={!isPercentage}
            type="button"
            onClick={() => {
              if (!isPercentage) return;
              setThresholdInput(String(configuration.tokenThreshold));
              updateConfiguration({ ...configuration, mode: "tokens" });
            }}
          >
            Token
          </button>
          <button
            aria-pressed={isPercentage}
            data-active={isPercentage}
            type="button"
            onClick={() => {
              if (isPercentage) return;
              setThresholdInput(String(configuration.percentageThreshold));
              updateConfiguration({ ...configuration, mode: "percentage" });
            }}
          >
            百分比
          </button>
        </div>
        <label className="settings-context-compression__threshold">
          <input
            aria-label={thresholdLabel}
            max={isPercentage ? 100 : 10_000_000}
            min="1"
            inputMode="numeric"
            placeholder={thresholdLabel}
            type="number"
            value={thresholdInput}
            onChange={(event) => {
              const value = event.target.value;
              setThresholdInput(value);
              const threshold = Number(value);
              if (!Number.isInteger(threshold) || threshold < 1) return;
              const cappedThreshold = Math.min(threshold, isPercentage ? 100 : 10_000_000);
              setThresholdInput(String(cappedThreshold));
              updateConfiguration(isPercentage
                ? { ...configuration, percentageThreshold: cappedThreshold }
                : { ...configuration, tokenThreshold: cappedThreshold },
              );
            }}
            onBlur={() => {
              const threshold = Number(thresholdInput);
              if (!Number.isInteger(threshold) || threshold < 1) {
                setThresholdInput(String(
                  isPercentage ? configuration.percentageThreshold : configuration.tokenThreshold,
                ));
              }
            }}
          />
        </label>
        <span className="settings-context-compression__state" data-state={saveState}>
          {saveState === "saving" || saveState === "pending"
            ? "正在更新"
            : saveState === "saved"
              ? "已更新"
              : saveState === "failed"
                ? "更新失败"
                : "自动保存"}
        </span>
      </div>
    </div>
  );
}

function ModelIdPicker({
  discoveredModels,
  modelId,
  onValueChange,
}: {
  discoveredModels: readonly DiscoveredModel[];
  modelId: string;
  onValueChange: (value: string) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredModels = useMemo(() => discoveredModels.filter((model) =>
    normalizedSearchQuery.length === 0 || [model.modelId, model.ownedBy ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery))
  ), [discoveredModels, normalizedSearchQuery]);

  function updateOpen(nextOpen: boolean, nextSearchQuery = ""): void {
    if (nextOpen) {
      setContentWidth(pickerRef.current?.getBoundingClientRect().width ?? null);
      setSearchQuery(nextSearchQuery);
    }
    setIsOpen(nextOpen);
  }

  return (
    <Popover open={isOpen} onOpenChange={updateOpen}>
      <PopoverAnchor asChild>
        <div ref={pickerRef} className="settings-model-id-picker">
          <input
            aria-autocomplete={discoveredModels.length > 0 ? "list" : undefined}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label="模型 ID"
            autoComplete="off"
            placeholder="模型 ID"
            role="combobox"
            title={discoveredModels.length > 0 ? "输入或从当前供应商已获取的模型中选择" : "模型 ID"}
            value={modelId}
            onChange={(event) => {
              const value = event.target.value;
              onValueChange(value);
              if (discoveredModels.length > 0) updateOpen(true, value);
            }}
            onFocus={() => {
              if (discoveredModels.length > 0) updateOpen(true);
            }}
          />
          <PopoverTrigger asChild>
            <button
              aria-label="选择当前供应商的模型"
              className="settings-model-id-picker__toggle"
              disabled={discoveredModels.length === 0}
              title={discoveredModels.length === 0 ? "请先获取当前供应商的模型" : "选择当前供应商的模型"}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={15} />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="settings-model-id-picker__content"
        onPointerDownOutside={(event) => {
          if (event.target instanceof Node && pickerRef.current?.contains(event.target)) {
            event.preventDefault();
          }
        }}
        side="bottom"
        style={contentWidth === null ? undefined : { width: `${contentWidth}px` }}
      >
        <div className="settings-model-id-picker__summary">
          当前供应商已获取 {discoveredModels.length} 个模型
        </div>
        <div className="settings-model-id-picker__options" role="listbox" aria-label="当前供应商的模型">
          {filteredModels.map((model) => (
            <button
              key={model.modelId}
              aria-selected={model.modelId === modelId}
              data-selected={model.modelId === modelId}
              role="option"
              type="button"
              onClick={() => {
                onValueChange(model.modelId);
                updateOpen(false);
              }}
            >
              <span>
                <strong>{model.modelId}</strong>
                {model.ownedBy !== null ? <small>{model.ownedBy}</small> : null}
              </span>
              {model.modelId === modelId ? <Check aria-hidden="true" size={15} /> : null}
            </button>
          ))}
          {filteredModels.length === 0 ? (
            <p>没有匹配的模型</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function modelApiBaseUrlPlaceholder(apiFormat: ModelApiFormat): string {
  switch (apiFormat) {
    case "anthropic-messages":
      return "https://api.anthropic.com/v1";
    case "google-gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "openai-chat-completions":
    case "openai-responses":
      return "https://api.openai.com/v1";
  }
}

type ConfigurationEditorMode = "visual" | "json";

function useIntegrationConfiguration(agentClient: AgentClient) {
  const [configuration, setConfiguration] = useState<IntegrationConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const latestSaveRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    void agentClient.getIntegrationConfiguration().then(
      (value) => {
        if (active) setConfiguration(value);
      },
      (reason: unknown) => {
        if (active) setError(errorMessage(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [agentClient]);

  const update = useCallback((next: IntegrationConfiguration): void => {
    setError(null);
    setConfiguration(next);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
  }, []);

  const reload = useCallback(async (): Promise<IntegrationConfiguration | null> => {
    try {
      const next = await agentClient.getIntegrationConfiguration();
      setConfiguration(next);
      setError(null);
      return next;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    }
  }, [agentClient]);

  const autoSave = useQueuedAutoSave({
    revision: saveRevision,
    save: (next: IntegrationConfiguration) => agentClient.saveIntegrationConfiguration(next),
    validate: (next: IntegrationConfiguration) => {
      const parsed = integrationConfigurationSchema.safeParse(next);
      return parsed.success ? parsed.data : null;
    },
    value: configuration ?? EMPTY_INTEGRATION_CONFIGURATION,
    onError: (reason) => setError(errorMessage(reason)),
    onSaved: (saved, revision) => {
      if (revision === latestSaveRevisionRef.current) setConfiguration(saved);
    },
  });

  return {
    autoSaveState: autoSave.state,
    configuration,
    error,
    flush: autoSave.flush,
    reload,
    setError,
    update,
  };
}

function ConfigurationModeSwitch({
  mode,
  onChange,
}: {
  mode: ConfigurationEditorMode;
  onChange: (mode: ConfigurationEditorMode) => void;
}): ReactElement {
  return (
    <div className="settings-segmented" role="group" aria-label="配置方式">
      <button aria-pressed={mode === "visual"} type="button" onClick={() => onChange("visual")}>
        <SlidersHorizontal aria-hidden="true" size={14} />
        图形
      </button>
      <button aria-pressed={mode === "json"} type="button" onClick={() => onChange("json")}>
        <Braces aria-hidden="true" size={14} />
        JSON
      </button>
    </div>
  );
}

function McpSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const state = useIntegrationConfiguration(agentClient);
  const editorRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<ConfigurationEditorMode>("visual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [json, setJson] = useState("[]");
  const appliedJsonRef = useRef<string | null>(null);
  const configurationWorkspaceRevision = useWorkbenchUiStore(
    (current) => current.configurationWorkspaceRevision,
  );
  const openConfigurationWorkspace = useWorkbenchUiStore(
    (current) => current.openConfigurationWorkspace,
  );
  const configuration = state.configuration;
  const updateConfiguration = state.update;
  const setConfigurationError = state.setError;
  const servers = configuration?.mcpServers ?? [];
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;

  function changeMode(nextMode: ConfigurationEditorMode): void {
    if (nextMode === mode) return;
    if (nextMode === "json" && configuration !== null) {
      const value = JSON.stringify(configuration.mcpServers, null, 2);
      appliedJsonRef.current = JSON.stringify(configuration.mcpServers);
      setJson(value);
    }
    if (nextMode === "visual" && !applyJson()) {
      return;
    }
    setConfigurationError(null);
    setMode(nextMode);
  }

  function updateServer(update: Partial<McpServerConfiguration>): void {
    if (configuration === null || selected === null) return;
    updateConfiguration({
      ...configuration,
      mcpServers: configuration.mcpServers.map((server) =>
        server.id === selected.id ? { ...server, ...update } : server,
      ),
    });
  }

  function replaceServer(server: McpServerConfiguration): void {
    if (configuration === null || selected === null) return;
    updateConfiguration({
      ...configuration,
      mcpServers: servers.map((candidate) => candidate.id === selected.id ? server : candidate),
    });
    setSelectedId(server.id);
    state.setError(null);
  }

  function focusConfigurationPath(path: string): void {
    const field = path.split(/[.[\]]/, 1)[0];
    if (field === undefined || field.length === 0) return;
    const container = editorRef.current?.querySelector<HTMLElement>(`[data-config-path="${field}"]`);
    const target = container?.matches("input, textarea, button")
      ? container
      : container?.querySelector<HTMLElement>("input, textarea, button");
    container?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus();
  }

  function addServer(): void {
    if (configuration === null) return;
    const id = nextConfigurationId("mcp", servers.map((server) => server.id));
    const server: McpServerConfiguration = {
      args: [],
      command: "npx",
      enabled: true,
      env: {},
      headers: {},
      id,
      name: "新 MCP Server",
      scope: "user",
      transport: "stdio",
      url: null,
    };
    updateConfiguration({ ...configuration, mcpServers: [...servers, server] });
    setSelectedId(id);
  }

  function applyJson(): boolean {
    if (configuration === null) return false;
    try {
      const parsed = mcpServerConfigurationListSchema.parse(JSON.parse(json));
      appliedJsonRef.current = JSON.stringify(parsed);
      updateConfiguration({ ...configuration, mcpServers: parsed });
      setSelectedId(parsed[0]?.id ?? null);
      setJson(JSON.stringify(parsed, null, 2));
      return true;
    } catch (reason) {
      setConfigurationError(configurationParseError(reason));
      return false;
    }
  }

  function deleteSelected(): void {
    if (configuration === null || selected === null) return;
    const remaining = servers.filter((server) => server.id !== selected.id);
    updateConfiguration({ ...configuration, mcpServers: remaining });
    setSelectedId(remaining[0]?.id ?? null);
  }

  function openFileWorkspace(): void {
    if (selected === null) return;
    state.flush();
    openConfigurationWorkspace({
      configurationId: selected.id,
      kind: "mcp",
      title: selected.name.trim() || selected.id,
    });
  }

  useEffect(() => {
    if (configurationWorkspaceRevision === 0) return;
    void state.reload().then((next) => {
      if (next === null) return;
      appliedJsonRef.current = JSON.stringify(next.mcpServers);
      setJson(JSON.stringify(next.mcpServers, null, 2));
      setSelectedId((current) => (
        next.mcpServers.some((server) => server.id === current)
          ? current
          : next.mcpServers[0]?.id ?? null
      ));
    });
  }, [configurationWorkspaceRevision, state.reload]);

  useEffect(() => {
    if (mode !== "json" || configuration === null) return undefined;
    const timer = window.setTimeout(() => {
      try {
        const parsed = mcpServerConfigurationListSchema.parse(JSON.parse(json));
        const serialized = JSON.stringify(parsed);
        if (serialized === appliedJsonRef.current) return;
        appliedJsonRef.current = serialized;
        updateConfiguration({ ...configuration, mcpServers: parsed });
        setSelectedId(parsed[0]?.id ?? null);
        setConfigurationError(null);
      } catch {
        // Keep the current visual configuration while the JSON draft is incomplete.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [configuration, json, mode, setConfigurationError, updateConfiguration]);

  return (
    <SettingsSectionHeader
      action={(
        <div className="settings-section-actions">
          <ConfigurationModeSwitch mode={mode} onChange={changeMode} />
          <button
            className="settings-secondary-button"
            disabled={selected === null}
            type="button"
            onClick={openFileWorkspace}
          >
            <PanelRight aria-hidden="true" size={15} />
            在右侧打开
          </button>
        </div>
      )}
      bodyClassName="settings-section__body--flush"
      eyebrow="Tools · Resources · Prompts"
      title="MCP 管理器"
    >
      {mode === "json" ? (
        <JsonConfigurationEditor
          error={state.error}
          saveState={state.autoSaveState}
          label="MCP JSON 配置"
          value={json}
          onChange={(value) => {
            setJson(value);
            setConfigurationError(null);
          }}
          onCommit={applyJson}
        />
      ) : configuration === null ? (
        <ConfigurationStatus error={state.error} />
      ) : (
        <div className="settings-integration-manager settings-integration-manager--mcp">
          <ConfigurationList
            actionLabel="添加 MCP Server"
            emptyLabel="暂无 MCP Server"
            headingLabel="MCP Server"
            icon={PlugZap}
            items={servers.map((server) => ({
              enabled: server.enabled,
              id: server.id,
              name: server.name,
              summary: server.transport === "stdio" ? server.command ?? "stdio" : server.url ?? "HTTP",
            }))}
            selectedId={selected?.id ?? null}
            onAdd={addServer}
            onSelect={setSelectedId}
          />
          {selected === null ? (
            <ConfigurationEmpty icon={PlugZap} label="添加 MCP Server" onAdd={addServer} />
          ) : (
            <section ref={editorRef} className="settings-integration-editor">
              <ConfigurationEditorHeader
                enabled={selected.enabled}
                icon={PlugZap}
                name={selected.name}
                onToggle={(enabled) => updateServer({ enabled })}
              />
              <div className="settings-integration-editor__body">
                <div className="settings-field-grid">
                  <ConfigurationField configPath="name" label="名称">
                    <input value={selected.name} onChange={(event) => updateServer({ name: event.target.value })} />
                  </ConfigurationField>
                  <ConfigurationField configPath="id" label="ID">
                    <input value={selected.id} onChange={(event) => {
                      const id = event.target.value;
                      setSelectedId(id);
                      updateServer({ id });
                    }} />
                  </ConfigurationField>
                  <ConfigurationField configPath="transport" label="传输方式">
                    <Select value={selected.transport} onValueChange={(transport) => updateServer({
                      command: transport === "stdio" ? selected.command ?? "npx" : null,
                      transport: transport as McpServerConfiguration["transport"],
                      url: transport === "streamable-http" ? selected.url ?? "" : null,
                    })}>
                      <SelectTrigger className="settings-select-trigger"><SelectValue /></SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="stdio">stdio</SelectItem>
                        <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </ConfigurationField>
                  <ScopeField configPath="scope" scope={selected.scope} onChange={(scope) => updateServer({ scope })} />
                  {selected.transport === "stdio" ? (
                    <ConfigurationField className="settings-field--wide" configPath="command" label="命令">
                      <input value={selected.command ?? ""} onChange={(event) => updateServer({ command: event.target.value })} />
                    </ConfigurationField>
                  ) : (
                    <ConfigurationField className="settings-field--wide" configPath="url" label="URL">
                      <input value={selected.url ?? ""} onChange={(event) => updateServer({ url: event.target.value })} />
                    </ConfigurationField>
                  )}
                  {selected.transport === "stdio" ? (
                    <ConfigurationField className="settings-field--wide" configPath="args" label="参数">
                      <textarea value={selected.args.join("\n")} onChange={(event) => updateServer({ args: event.target.value.split(/\r?\n/).filter(Boolean) })} />
                    </ConfigurationField>
                  ) : null}
                </div>
                {selected.transport === "stdio" ? (
                  <KeyValueEditor configPath="env" label="环境变量" value={selected.env} onChange={(env) => updateServer({ env })} />
                ) : (
                  <KeyValueEditor configPath="headers" label="请求头" value={selected.headers} onChange={(headers) => updateServer({ headers })} />
                )}
              </div>
              <ConfigurationEditorFooter
                error={state.error}
                saveState={state.autoSaveState}
                onDelete={deleteSelected}
              />
            </section>
          )}
          {selected === null ? null : (
            <McpConfigurationInspector
              key={selected.id}
              server={selected}
              onApply={replaceServer}
              onSelectPath={focusConfigurationPath}
            />
          )}
        </div>
      )}
    </SettingsSectionHeader>
  );
}

function McpConfigurationInspector({
  onApply,
  onSelectPath,
  server,
}: {
  onApply: (server: McpServerConfiguration) => void;
  onSelectPath: (path: string) => void;
  server: McpServerConfiguration;
}): ReactElement {
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  const [mode, setMode] = useState<"json" | "tree">("tree");
  const [draft, setDraft] = useState(() => JSON.stringify(server, null, 2));
  const [error, setError] = useState<string | null>(null);

  function changeMode(nextMode: "json" | "tree"): void {
    if (nextMode === "json") setDraft(JSON.stringify(server, null, 2));
    setError(null);
    setMode(nextMode);
  }

  function applyJson(): void {
    try {
      const parsed = mcpServerConfigurationSchema.parse(JSON.parse(draft));
      onApply(parsed);
      setDraft(JSON.stringify(parsed, null, 2));
      setError(null);
      setMode("tree");
    } catch (reason) {
      setError(configurationParseError(reason));
    }
  }

  return (
    <aside className="settings-configuration-inspector" aria-label="当前 MCP 配置">
      <header className="settings-configuration-inspector__header">
        <div>
          <span><ListTree aria-hidden="true" size={15} /></span>
          <span><strong>配置结构</strong><small>{server.id}</small></span>
        </div>
        <div className="settings-configuration-inspector__modes" role="group" aria-label="当前 MCP 配置视图">
          <button aria-pressed={mode === "tree"} type="button" onClick={() => changeMode("tree")}>
            <ListTree aria-hidden="true" size={13} />
            结构
          </button>
          <button aria-pressed={mode === "json"} type="button" onClick={() => changeMode("json")}>
            <FileJson2 aria-hidden="true" size={13} />
            JSON
          </button>
        </div>
      </header>
      {mode === "tree" ? (
        <JsonHierarchyTree label={server.id} value={server} onSelectPath={onSelectPath} />
      ) : (
        <div className="settings-configuration-inspector__editor">
          <DocumentCodeEditor
            ariaLabel="当前 MCP JSON"
            isDark={isDark}
            language="json"
            value={draft}
            onChange={setDraft}
            onSave={applyJson}
          />
          {error === null ? null : <p role="alert">{error}</p>}
          <footer>
            <button className="settings-primary-button" type="button" onClick={applyJson}>
              应用到表单
            </button>
          </footer>
        </div>
      )}
    </aside>
  );
}

function JsonHierarchyTree({
  label,
  onSelectPath,
  value,
}: {
  label: string;
  onSelectPath: (path: string) => void;
  value: unknown;
}): ReactElement {
  return (
    <div className="settings-json-tree" role="tree" aria-label="MCP 配置层级">
      <JsonHierarchyNode
        depth={0}
        label={label}
        path=""
        value={value}
        onSelectPath={onSelectPath}
      />
    </div>
  );
}

function JsonHierarchyNode({
  depth,
  label,
  onSelectPath,
  path,
  value,
}: {
  depth: number;
  label: string;
  onSelectPath: (path: string) => void;
  path: string;
  value: unknown;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const entries: readonly (readonly [string, unknown])[] | null = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : value !== null && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
      : null;
  const expandable = entries !== null;
  const summary = expandable
    ? `${Array.isArray(value) ? "Array" : "Object"}(${entries.length})`
    : jsonLeafSummary(value);

  return (
    <div className="settings-json-tree__node" role="treeitem" aria-expanded={expandable ? !collapsed : undefined}>
      <div className="settings-json-tree__row" style={{ paddingLeft: `${6 + depth * 13}px` }}>
        {expandable ? (
          <button
            aria-label={`${collapsed ? "展开" : "折叠"}${label}`}
            className="settings-json-tree__toggle"
            data-expanded={!collapsed}
            type="button"
            onClick={() => setCollapsed((current) => !current)}
          >
            <ChevronRight aria-hidden="true" size={13} />
          </button>
        ) : <span className="settings-json-tree__spacer" />}
        <button
          className="settings-json-tree__field"
          disabled={path.length === 0}
          title={path.length === 0 ? label : path}
          type="button"
          onClick={() => onSelectPath(path)}
        >
          <span>{label}</span>
          <small data-kind={jsonValueKind(value)}>{summary}</small>
        </button>
      </div>
      {expandable && !collapsed ? (
        <div role="group">
          {entries.map(([key, entry]) => (
            <JsonHierarchyNode
              key={`${path}:${key}`}
              depth={depth + 1}
              label={Array.isArray(value) ? `[${key}]` : key}
              path={Array.isArray(value) ? `${path}[${key}]` : path.length === 0 ? key : `${path}.${key}`}
              value={entry}
              onSelectPath={onSelectPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function jsonValueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonLeafSummary(value: unknown): string {
  if (typeof value === "string") return value.length === 0 ? '""' : value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return jsonValueKind(value);
}

function SkillsSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const state = useIntegrationConfiguration(agentClient);
  const [defaultDirectoryPath, setDefaultDirectoryPath] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [newSkillDirectoryPath, setNewSkillDirectoryPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const configurationWorkspaceRevision = useWorkbenchUiStore(
    (current) => current.configurationWorkspaceRevision,
  );
  const openConfigurationWorkspace = useWorkbenchUiStore(
    (current) => current.openConfigurationWorkspace,
  );
  const configuration = state.configuration;
  const skills = configuration?.skills ?? [];
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null;
  const creationDirectoryPath = newSkillDirectoryPath ?? defaultDirectoryPath;

  const discoverSkills = useCallback(async (): Promise<void> => {
    setIsDiscovering(true);
    state.setError(null);
    try {
      const result = await agentClient.discoverSkillDocuments();
      setDefaultDirectoryPath(result.defaultDirectoryPath);
      setNewSkillDirectoryPath((current) => current ?? result.defaultDirectoryPath);
      await state.reload();
    } catch (reason) {
      state.setError(errorMessage(reason));
    } finally {
      setIsDiscovering(false);
    }
  }, [agentClient, state.reload, state.setError]);

  useEffect(() => {
    void discoverSkills();
  }, [discoverSkills]);

  useEffect(() => {
    if (configurationWorkspaceRevision === 0) return;
    void discoverSkills();
  }, [configurationWorkspaceRevision, discoverSkills]);

  function updateSkill(update: Partial<SkillConfiguration>): void {
    if (configuration === null || selected === null) return;
    state.update({
      ...configuration,
      skills: skills.map((skill) => skill.id === selected.id ? { ...skill, ...update } : skill),
    });
  }

  async function createSkill(): Promise<void> {
    if (creationDirectoryPath === null) return;
    state.setError(null);
    try {
      const document = await agentClient.createSkillDocument({
        directoryPath: creationDirectoryPath,
      });
      const next = await state.reload();
      const created = next?.skills.find((skill) => (
        skill.entryPath.toLocaleLowerCase("en-US") === document.entryPath.toLocaleLowerCase("en-US")
      ));
      if (created === undefined) return;
      setSelectedId(created.id);
      openConfigurationWorkspace({
        configurationId: created.id,
        kind: "skill",
        title: created.name,
      });
    } catch (reason) {
      state.setError(errorMessage(reason));
    }
  }

  async function chooseSkillDirectory(): Promise<void> {
    state.setError(null);
    try {
      const result = await agentClient.chooseSkillDirectory();
      if (result === null) return;
      setDefaultDirectoryPath(result.defaultDirectoryPath);
      setNewSkillDirectoryPath(result.defaultDirectoryPath);
      await state.reload();
    } catch (reason) {
      state.setError(errorMessage(reason));
    }
  }

  function removeDirectory(directoryPath: string): void {
    if (configuration === null) return;
    state.update({
      ...configuration,
      skillDirectories: configuration.skillDirectories.filter((path) => path !== directoryPath),
    });
    if (newSkillDirectoryPath === directoryPath) {
      setNewSkillDirectoryPath(defaultDirectoryPath);
    }
  }

  function removeSelected(): void {
    if (configuration === null || selected === null) return;
    const remaining = skills.filter((skill) => skill.id !== selected.id);
    state.update({ ...configuration, skills: remaining });
    setSelectedId(remaining[0]?.id ?? null);
  }

  function openFileWorkspace(): void {
    if (selected === null) return;
    state.flush();
    openConfigurationWorkspace({
      configurationId: selected.id,
      kind: "skill",
      title: selected.name,
    });
  }

  return (
    <SettingsSectionHeader
      action={(
        <div className="settings-section-actions">
          <Select
            disabled={creationDirectoryPath === null}
            value={creationDirectoryPath ?? ""}
            onValueChange={setNewSkillDirectoryPath}
          >
            <SelectTrigger aria-label="新建 Skill 的目录" className="settings-select-trigger settings-skill-source-select">
              <SelectValue placeholder="正在读取目录" />
            </SelectTrigger>
            <SelectContent align="end">
              {defaultDirectoryPath === null ? null : (
                <SelectItem value={defaultDirectoryPath}>默认目录</SelectItem>
              )}
              {(configuration?.skillDirectories ?? []).map((directoryPath) => (
                <SelectItem key={directoryPath} value={directoryPath}>{directoryPath}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            className="settings-secondary-button"
            disabled={isDiscovering}
            type="button"
            onClick={() => void chooseSkillDirectory()}
          >
            <FolderOpen aria-hidden="true" size={15} />
            添加外部目录
          </button>
          <button
            className="settings-secondary-button"
            disabled={selected === null}
            type="button"
            onClick={openFileWorkspace}
          >
            <PanelRight aria-hidden="true" size={15} />
            在右侧打开
          </button>
        </div>
      )}
      bodyClassName="settings-section__body--flush"
      eyebrow="指令 · 流程 · 模板"
      title="Skill 管理器"
    >
      {configuration === null ? (
        <ConfigurationStatus error={state.error} />
      ) : (
        <div className="settings-integration-manager settings-integration-manager--skill">
          <section className="settings-skill-sources" aria-label="Skill 扫描目录">
            <div className="settings-skill-sources__item">
              <span>默认目录</span>
              <strong title={defaultDirectoryPath ?? ""}>{defaultDirectoryPath ?? "正在扫描"}</strong>
              <button
                aria-label="重新扫描 Skill 目录"
                disabled={isDiscovering}
                title="重新扫描 Skill 目录"
                type="button"
                onClick={() => void discoverSkills()}
              >
                <RefreshCw aria-hidden="true" className={isDiscovering ? "settings-spin" : undefined} size={14} />
              </button>
            </div>
            {configuration.skillDirectories.map((directoryPath) => (
              <div className="settings-skill-sources__item" key={directoryPath}>
                <span>外部目录</span>
                <strong title={directoryPath}>{directoryPath}</strong>
                <button
                  aria-label={`停止扫描 ${directoryPath}`}
                  title="停止扫描此目录"
                  type="button"
                  onClick={() => removeDirectory(directoryPath)}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            ))}
          </section>
          <ConfigurationList
            actionLabel="新建 Skill"
            emptyLabel="暂无 Skill"
            headingLabel="Skill 列表"
            icon={Sparkles}
            items={skills.map((skill) => ({
              enabled: skill.enabled,
              id: skill.id,
              name: skill.name,
              summary: skill.entryPath,
            }))}
            selectedId={selected?.id ?? null}
            onAdd={() => void createSkill()}
            onSelect={setSelectedId}
          />
          {selected === null ? (
            <ConfigurationEmpty icon={Sparkles} label="新建 Skill" onAdd={() => void createSkill()} />
          ) : (
            <section className="settings-integration-editor settings-skill-metadata">
              <ConfigurationEditorHeader
                enabled={selected.enabled}
                icon={Sparkles}
                name={selected.name}
                onToggle={(enabled) => updateSkill({ enabled })}
              />
              <div className="settings-integration-editor__body">
                <div className="settings-field-grid settings-skill-fields">
                  <ConfigurationField className="settings-field--wide" label="SKILL.md 路径">
                    <input readOnly title={selected.entryPath} value={selected.entryPath} />
                  </ConfigurationField>
                  <ScopeField scope={selected.scope} onChange={(scope) => updateSkill({ scope })} />
                  <ConfigurationField className="settings-field--wide" label="MCP 依赖">
                    <input
                      value={selected.mcpDependencies.join(", ")}
                      onChange={(event) => updateSkill({
                        mcpDependencies: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                      })}
                    />
                  </ConfigurationField>
                </div>
              </div>
              <footer className="settings-integration-editor__footer">
                <div>
                  {state.error === null
                    ? <span>{autoSaveStateLabel(state.autoSaveState)}</span>
                    : <p role="alert">{state.error}</p>}
                </div>
                <div className="settings-skill-metadata__actions">
                  <button className="settings-secondary-button" type="button" onClick={openFileWorkspace}>
                    <PanelRight aria-hidden="true" size={14} />
                    在右侧打开
                  </button>
                  <button className="settings-danger-button" type="button" onClick={removeSelected}>
                    <Trash2 aria-hidden="true" size={14} />
                    移除登记
                  </button>
                </div>
              </footer>
            </section>
          )}
        </div>
      )}
    </SettingsSectionHeader>
  );
}

function ConfigurationStatus({ error }: { error: string | null }): ReactElement {
  return (
    <div className="settings-configuration-status" role={error === null ? "status" : "alert"}>
      {error ?? "正在读取配置..."}
    </div>
  );
}

function ConfigurationList({
  actionLabel,
  emptyLabel,
  headingLabel,
  icon: Icon,
  items,
  onAdd,
  onSelect,
  selectedId,
}: {
  actionLabel: string;
  emptyLabel: string;
  headingLabel: string;
  icon: LucideIcon;
  items: { enabled: boolean; id: string; name: string; summary: string }[];
  onAdd: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}): ReactElement {
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const pageCount = Math.max(1, Math.ceil(items.length / CONFIGURATIONS_PER_PAGE));
  const currentPage = selectedIndex < 0
    ? 0
    : Math.floor(selectedIndex / CONFIGURATIONS_PER_PAGE);
  const pagedItems = items.slice(
    currentPage * CONFIGURATIONS_PER_PAGE,
    (currentPage + 1) * CONFIGURATIONS_PER_PAGE,
  );

  function selectPage(page: number): void {
    const firstItem = items[page * CONFIGURATIONS_PER_PAGE];
    if (firstItem !== undefined) onSelect(firstItem.id);
  }

  return (
    <aside className="settings-integration-list">
      <header className="settings-integration-list__heading">
        <strong>{headingLabel}</strong>
        <button
          className="settings-primary-button settings-integration-list__add"
          type="button"
          onClick={onAdd}
        >
          <CirclePlus aria-hidden="true" size={14} />
          {actionLabel}
        </button>
      </header>
      <div className="settings-integration-list__items">
        {items.length === 0 ? <p>{emptyLabel}</p> : pagedItems.map((item) => (
          <button
            key={item.id}
            aria-pressed={selectedId === item.id}
            className="settings-integration-list__item"
            data-active={selectedId === item.id}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <span className="settings-integration-list__icon"><Icon aria-hidden="true" size={15} /></span>
            <span className="settings-integration-list__identity">
              <strong>{item.name}</strong>
              <small>{item.summary}</small>
            </span>
            <span className="settings-integration-list__status" data-enabled={item.enabled} />
          </button>
        ))}
      </div>
      <footer className="settings-integration-list__footer">
        <span className="settings-provider-list__count">共 {items.length} 项</span>
        <div
          aria-label={`${headingLabel}分页`}
          className="settings-provider-list__pagination-controls"
        >
          <button
            aria-label="上一页"
            disabled={currentPage === 0}
            title="上一页"
            type="button"
            onClick={() => selectPage(Math.max(0, currentPage - 1))}
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </button>
          <span aria-label={`第 ${currentPage + 1} 页，共 ${pageCount} 页`}>
            {currentPage + 1} / {pageCount}
          </span>
          <button
            aria-label="下一页"
            disabled={currentPage >= pageCount - 1}
            title="下一页"
            type="button"
            onClick={() => selectPage(Math.min(pageCount - 1, currentPage + 1))}
          >
            <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function ConfigurationEmpty({
  icon: Icon,
  label,
  onAdd,
}: {
  icon: LucideIcon;
  label: string;
  onAdd: () => void;
}): ReactElement {
  return (
    <div className="settings-integration-empty">
      <Icon aria-hidden="true" size={24} />
      <button className="settings-secondary-button" type="button" onClick={onAdd}>
        <CirclePlus aria-hidden="true" size={15} />
        {label}
      </button>
    </div>
  );
}

function ConfigurationEditorHeader({
  enabled,
  icon: Icon,
  name,
  onToggle,
}: {
  enabled: boolean;
  icon: LucideIcon;
  name: string;
  onToggle: (enabled: boolean) => void;
}): ReactElement {
  return (
    <header className="settings-integration-editor__header">
      <span className="settings-configuration-row__icon"><Icon aria-hidden="true" size={16} /></span>
      <div>
        <p>当前配置</p>
        <h3>{name.trim() || "未命名配置"}</h3>
      </div>
      <label className="settings-switch" data-config-path="enabled">
        <input
          aria-label={enabled ? "停用配置" : "启用配置"}
          checked={enabled}
          type="checkbox"
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </header>
  );
}

function ConfigurationField({
  children,
  className = "",
  configPath,
  label,
}: {
  children: ReactNode;
  className?: string;
  configPath?: string;
  label: string;
}): ReactElement {
  return (
    <label className={`settings-field ${className}`.trim()} data-config-path={configPath}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ScopeField({
  configPath,
  onChange,
  scope,
}: {
  configPath?: string;
  onChange: (scope: ConfigurationScope) => void;
  scope: ConfigurationScope;
}): ReactElement {
  return (
    <ConfigurationField {...(configPath === undefined ? {} : { configPath })} label="作用域">
      <Select value={scope} onValueChange={(value) => onChange(value as ConfigurationScope)}>
        <SelectTrigger className="settings-select-trigger"><SelectValue /></SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="user">用户</SelectItem>
          <SelectItem value="team">团队</SelectItem>
          <SelectItem value="project">项目</SelectItem>
        </SelectContent>
      </Select>
    </ConfigurationField>
  );
}

function KeyValueEditor({
  configPath,
  label,
  onChange,
  value,
}: {
  configPath?: string;
  label: string;
  onChange: (value: Record<string, string>) => void;
  value: Record<string, string>;
}): ReactElement {
  const entries = Object.entries(value);

  function updateEntry(index: number, key: string, entryValue: string): void {
    onChange(Object.fromEntries(entries.map(([currentKey, currentValue], currentIndex) =>
      currentIndex === index ? [key, entryValue] : [currentKey, currentValue],
    )));
  }

  function addEntry(): void {
    const key = nextConfigurationId("KEY", Object.keys(value));
    onChange({ ...value, [key]: "" });
  }

  return (
    <section className="settings-key-value-editor" data-config-path={configPath}>
      <header>
        <h4>{label}</h4>
        <button aria-label={`添加${label}`} title={`添加${label}`} type="button" onClick={addEntry}>
          <CirclePlus aria-hidden="true" size={15} />
        </button>
      </header>
      {entries.length === 0 ? <p>暂无{label}</p> : entries.map(([key, entryValue], index) => (
        <div key={`${key}-${index}`} className="settings-key-value-editor__row">
          <input aria-label={`${label}名称`} value={key} onChange={(event) => updateEntry(index, event.target.value, entryValue)} />
          <input aria-label={`${label}值`} value={entryValue} onChange={(event) => updateEntry(index, key, event.target.value)} />
          <button
            aria-label={`删除${key}`}
            title={`删除${key}`}
            type="button"
            onClick={() => onChange(Object.fromEntries(entries.filter((_, currentIndex) => currentIndex !== index)))}
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}

function ConfigurationEditorFooter({
  error,
  saveState,
  onDelete,
}: {
  error: string | null;
  saveState: AutoSaveState;
  onDelete: () => void;
}): ReactElement {
  return (
    <footer className="settings-integration-editor__footer">
      <div>
        {error === null ? <span>{autoSaveStateLabel(saveState)}</span> : <p role="alert">{error}</p>}
      </div>
      <button className="settings-danger-button" type="button" onClick={onDelete}>
        <Trash2 aria-hidden="true" size={14} />
        删除
      </button>
    </footer>
  );
}

function JsonConfigurationEditor({
  error,
  saveState,
  label,
  onChange,
  onCommit,
  value,
}: {
  error: string | null;
  saveState: AutoSaveState;
  label: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  value: string;
}): ReactElement {
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  return (
    <div className="settings-json-editor">
      <div className="settings-json-editor__toolbar">
        <span><Braces aria-hidden="true" size={15} />{label}</span>
        <small>{autoSaveStateLabel(saveState)}</small>
      </div>
      <DocumentCodeEditor
        ariaLabel={label}
        isDark={isDark}
        language="json"
        value={value}
        onChange={onChange}
        onSave={onCommit}
      />
      {error === null ? null : <p className="settings-operation-error" role="alert">{error}</p>}
    </div>
  );
}

function autoSaveStateLabel(state: AutoSaveState): string {
  switch (state) {
    case "failed":
      return "自动保存失败";
    case "invalid":
      return "等待配置完成后自动保存";
    case "pending":
      return "即将自动保存";
    case "saving":
      return "正在自动保存";
    case "saved":
      return "已自动保存";
    case "idle":
      return "修改后自动保存";
  }
}

function nextConfigurationId(prefix: string, ids: readonly string[]): string {
  const used = new Set(ids);
  let suffix = 1;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function configurationParseError(reason: unknown): string {
  if (reason !== null && typeof reason === "object" && "issues" in reason) {
    const issues = (reason as { issues?: { message?: unknown }[] }).issues;
    const message = issues?.[0]?.message;
    if (typeof message === "string") return message;
  }
  return reason instanceof Error ? reason.message : "JSON 配置无效。";
}

function errorMessage(reason: unknown): string {
  return getUserErrorMessage(reason, "配置操作失败。");
}

function ArchivedConversationsSettings({
  agentClient,
}: {
  agentClient: AgentClient;
}): ReactElement {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [busyOperation, setBusyOperation] = useState<"delete" | "restore" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      agentClient.listConversations(),
      agentClient.listProjects(),
    ])
      .then(([nextConversations, nextProjects]) => {
        if (disposed) return;
        setConversations(nextConversations);
        setProjects(nextProjects);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setOperationError(getUserErrorMessage(reason, "无法读取已归档对话"));
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  const archivedConversations = useMemo(
    () => getArchivedConversations(conversations),
    [conversations],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const restoreConversation = async (conversation: ConversationSummary): Promise<void> => {
    setBusyConversationId(conversation.id);
    setBusyOperation("restore");
    setOperationError(null);
    try {
      const restored = await agentClient.setConversationArchived({
        archived: false,
        conversationId: conversation.id,
      });
      setConversations((current) => current.map((candidate) =>
        candidate.id === restored.id ? restored : candidate
      ));
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setBusyConversationId(null);
      setBusyOperation(null);
    }
  };

  const permanentlyDeleteConversation = async (
    conversation: ConversationSummary,
  ): Promise<void> => {
    setBusyConversationId(conversation.id);
    setBusyOperation("delete");
    setOperationError(null);
    try {
      await agentClient.deleteConversation({ conversationId: conversation.id });
      setConversations((current) => current.filter(
        (candidate) => candidate.id !== conversation.id,
      ));
      setPendingDelete(null);
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setBusyConversationId(null);
      setBusyOperation(null);
    }
  };

  return (
    <SettingsSectionHeader
      eyebrow="对话生命周期"
      title="已归档对话"
      action={<span className="settings-state-badge">保留 {ARCHIVED_CONVERSATION_RETENTION_DAYS} 天</span>}
    >
      <p className="settings-archived-description">
        归档对话不会显示在项目栏中，到期后由应用自动永久删除。
      </p>
      {operationError === null ? null : (
        <p className="settings-operation-error" role="alert">{operationError}</p>
      )}
      {isLoading ? (
        <div className="settings-archived-empty" role="status">
          <LoaderCircle aria-hidden="true" className="settings-spin" size={18} />
          正在读取归档记录
        </div>
      ) : archivedConversations.length === 0 ? (
        <div className="settings-archived-empty">
          <Archive aria-hidden="true" size={22} />
          <strong>暂无已归档对话</strong>
          <span>从项目栏归档的对话会显示在这里。</span>
        </div>
      ) : (
        <div className="settings-archived-list" role="list">
          {archivedConversations.map((conversation) => {
            const isRestoring = busyConversationId === conversation.id
              && busyOperation === "restore";
            const isDeleting = busyConversationId === conversation.id
              && busyOperation === "delete";
            const remainingDays = getArchivedConversationDaysRemaining(
              conversation.archivedAt,
            );
            const projectName = conversation.projectId === null
              ? "临时对话"
              : projectNames.get(conversation.projectId) ?? "项目已移除";

            return (
              <article key={conversation.id} className="settings-archived-row" role="listitem">
                <span className="settings-configuration-row__icon">
                  <MessageSquareText aria-hidden="true" size={16} />
                </span>
                <div className="settings-archived-row__identity">
                  <strong>{conversation.title}</strong>
                  <span>{projectName}</span>
                </div>
                <dl className="settings-archived-row__meta">
                  <div>
                    <dt>归档时间</dt>
                    <dd>{formatArchivedConversationDate(conversation.archivedAt)}</dd>
                  </div>
                  <div>
                    <dt>自动清理</dt>
                    <dd>{remainingDays === 0 ? "等待清理" : `还剩 ${remainingDays} 天`}</dd>
                  </div>
                </dl>
                <div className="settings-archived-row__actions">
                  <button
                    className="settings-secondary-button"
                    disabled={busyConversationId !== null}
                    type="button"
                    onClick={() => void restoreConversation(conversation)}
                  >
                    {isRestoring ? (
                      <LoaderCircle aria-hidden="true" className="settings-spin" size={14} />
                    ) : (
                      <ArchiveRestore aria-hidden="true" size={14} />
                    )}
                    {isRestoring ? "恢复中" : "恢复"}
                  </button>
                  <button
                    className="settings-danger-button"
                    disabled={busyConversationId !== null}
                    type="button"
                    onClick={() => setPendingDelete(conversation)}
                  >
                    {isDeleting ? (
                      <LoaderCircle aria-hidden="true" className="settings-spin" size={14} />
                    ) : (
                      <Trash2 aria-hidden="true" size={14} />
                    )}
                    永久删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingDelete === null ? null : (
        <div
          className="settings-archived-dialog-backdrop"
          onClick={(event) => {
            if (event.currentTarget === event.target && busyConversationId === null) {
              setPendingDelete(null);
            }
          }}
        >
          <section
            aria-labelledby="settings-archived-delete-title"
            aria-modal="true"
            className="settings-archived-dialog"
            role="dialog"
          >
            <header>
              <Trash2 aria-hidden="true" size={17} />
              <h3 id="settings-archived-delete-title">永久删除对话</h3>
            </header>
            <p>“{pendingDelete.title}”的消息、任务和工具记录都会被删除，且无法恢复。</p>
            <footer>
              <button
                autoFocus
                className="settings-secondary-button"
                disabled={busyConversationId !== null}
                type="button"
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                className="settings-danger-button"
                disabled={busyConversationId !== null}
                type="button"
                onClick={() => void permanentlyDeleteConversation(pendingDelete)}
              >
                {busyConversationId === pendingDelete.id && busyOperation === "delete" ? (
                  <LoaderCircle aria-hidden="true" className="settings-spin" size={14} />
                ) : (
                  <Trash2 aria-hidden="true" size={14} />
                )}
                {busyConversationId === pendingDelete.id && busyOperation === "delete"
                  ? "删除中"
                  : "永久删除"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </SettingsSectionHeader>
  );
}

function formatArchivedConversationDate(archivedAt: string | null): string {
  if (archivedAt === null) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(archivedAt));
}

function PermissionsSettings({
  onChange,
  permissions,
}: {
  onChange: (permissionId: PermissionRule["id"], policy: PermissionRule["policy"]) => void;
  permissions: PermissionRule[];
}): ReactElement {
  return (
    <SettingsSectionHeader eyebrow="默认审批策略" title="权限">
      <div className="settings-permission-list" role="list">
        {permissions.map((permission) => (
          <article key={permission.id} className="settings-permission-row" role="listitem">
            <span className="settings-configuration-row__icon">
              {permission.policy === "ask" ? (
                <KeyRound aria-hidden="true" size={16} />
              ) : permission.policy === "allow" ? (
                <BadgeCheck aria-hidden="true" size={16} />
              ) : (
                <ShieldCheck aria-hidden="true" size={16} />
              )}
            </span>
            <div>
              <strong>{permission.action}</strong>
              <span>{permission.scope}</span>
            </div>
            <Select
              value={permission.policy}
              onValueChange={(policy) =>
                onChange(
                  permission.id,
                  policy as PermissionRule["policy"],
                )
              }
            >
              <SelectTrigger
                aria-label={`${permission.action}默认策略`}
                className="settings-permission-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="allow">自动允许</SelectItem>
                <SelectItem value="ask">每次审批</SelectItem>
                <SelectItem value="unavailable">MVP 未提供</SelectItem>
              </SelectContent>
            </Select>
          </article>
        ))}
      </div>
    </SettingsSectionHeader>
  );
}

function TerminalSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const savedConfiguration = useWorkbenchUiStore((state) => state.terminalConfiguration);
  const setTerminalConfiguration = useWorkbenchUiStore(
    (state) => state.setTerminalConfiguration,
  );
  const [draft, setDraft] = useState<TerminalConfiguration>(savedConfiguration);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<RuntimePlatform>("win32");
  const [saveRevision, setSaveRevision] = useState(0);
  const draftRef = useRef(draft);
  const latestSaveRevisionRef = useRef(0);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let disposed = false;

    void Promise.all([
      agentClient.getTerminalConfiguration(),
      agentClient.getRuntimeInfo(),
    ])
      .then(([configuration, runtime]) => {
        if (disposed) return;
        setDraft(configuration);
        setPlatform(runtime.platform);
        setTerminalConfiguration(configuration);
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取终端配置");
      });

    return () => {
      disposed = true;
    };
  }, [agentClient, setTerminalConfiguration]);

  const updateDraft = useCallback((update: Partial<TerminalConfiguration>): void => {
    const next = { ...draftRef.current, ...update };
    draftRef.current = next;
    setDraft(next);
    setTerminalConfiguration(next);
    setOperationError(null);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
  }, [setTerminalConfiguration]);

  const autoSave = useQueuedAutoSave({
    revision: saveRevision,
    save: (next: TerminalConfiguration) => agentClient.saveTerminalConfiguration(next),
    validate: (next: TerminalConfiguration) => {
      const parsed = terminalConfigurationSchema.safeParse(next);
      return parsed.success ? parsed.data : null;
    },
    value: draft,
    onError: (reason) => setOperationError(errorMessage(reason)),
    onSaved: (configuration, revision) => {
      if (revision !== latestSaveRevisionRef.current) return;
      draftRef.current = configuration;
      setDraft(configuration);
      setTerminalConfiguration(configuration);
    },
  });

  const updateNumber = (
    field: "fontSize" | "lineHeight",
    minimum: number,
    maximum: number,
    value: number,
  ): void => {
    if (!Number.isFinite(value)) return;
    updateDraft({ [field]: Math.min(maximum, Math.max(minimum, value)) });
  };

  const shellOptions = terminalShellOptions(platform);

  return (
    <SettingsSectionHeader
      eyebrow="命令工具"
      title="终端"
    >
      <div className="settings-terminal-form">
        <div className="settings-terminal-grid">
          <label className="settings-field">
            <span>终端</span>
            <Select
              value={draft.shell}
              onValueChange={(shell) => {
                updateDraft({ shell: shell as TerminalShell });
              }}
            >
              <SelectTrigger aria-label="终端" className="settings-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {shellOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="settings-field">
            <span>输出字符集</span>
            <Select
              value={draft.outputEncoding}
              onValueChange={(outputEncoding) => {
                updateDraft({
                  outputEncoding: outputEncoding as TerminalOutputEncoding,
                });
              }}
            >
              <SelectTrigger aria-label="输出字符集" className="settings-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {TERMINAL_OUTPUT_ENCODING_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="settings-field settings-field--wide">
            <span>字体</span>
            <input
              aria-label="终端字体"
              value={draft.fontFamily}
              onChange={(event) => {
                updateDraft({ fontFamily: event.target.value });
              }}
            />
          </label>

          <label className="settings-field">
            <span>字号</span>
            <input
              aria-label="终端字号"
              max={28}
              min={10}
              step={1}
              type="number"
              value={draft.fontSize}
              onChange={(event) =>
                updateNumber("fontSize", 10, 28, event.currentTarget.valueAsNumber)
              }
            />
          </label>

          <label className="settings-field">
            <span>行高</span>
            <input
              aria-label="终端行高"
              max={2.2}
              min={1}
              step={0.05}
              type="number"
              value={draft.lineHeight}
              onChange={(event) =>
                updateNumber("lineHeight", 1, 2.2, event.currentTarget.valueAsNumber)
              }
            />
          </label>
        </div>

        <section
          aria-label="终端预览"
          className="settings-terminal-preview"
          style={{
            fontFamily: draft.fontFamily,
            fontSize: `${draft.fontSize}px`,
            lineHeight: draft.lineHeight,
          }}
        >
          <header>
            <span>{terminalShellLabel(draft.shell, platform)}</span>
            <span>{terminalOutputEncodingLabel(draft.outputEncoding)}</span>
          </header>
          <pre>
            <code>
              <span>$</span> Write-Output "中文输出"
              {"\n\n中文输出"}
            </code>
          </pre>
        </section>

        {operationError !== null ? (
          <p className="settings-terminal-status" role="alert">{operationError}</p>
        ) : (
          <p className="settings-terminal-status" role="status">
            {autoSaveStateLabel(autoSave.state)}
          </p>
        )}
      </div>
    </SettingsSectionHeader>
  );
}

function terminalShellOptions(
  platform: RuntimePlatform,
): readonly { label: string; value: TerminalShell }[] {
  if (platform === "win32") {
    return [
      { label: "系统默认（Windows PowerShell）", value: "system" },
      { label: "Windows PowerShell", value: "powershell" },
      { label: "PowerShell 7", value: "pwsh" },
      { label: "命令提示符", value: "cmd" },
    ];
  }

  return [
    { label: "系统默认（PowerShell 7）", value: "system" },
    { label: "PowerShell 7", value: "pwsh" },
    { label: "Bash", value: "bash" },
  ];
}

function terminalShellLabel(shell: TerminalShell, platform: RuntimePlatform): string {
  return terminalShellOptions(platform).find((option) => option.value === shell)?.label
    ?? "系统默认";
}

function terminalOutputEncodingLabel(encoding: TerminalOutputEncoding): string {
  return TERMINAL_OUTPUT_ENCODING_OPTIONS.find((option) => option.value === encoding)?.label
    ?? encoding;
}

function AppearanceSettings(): ReactElement {
  const setThemeMode = useWorkbenchUiStore((state) => state.setThemeMode);
  const themeMode = useWorkbenchUiStore((state) => state.themeMode);

  return (
    <SettingsSectionHeader eyebrow="应用界面" title="外观">
      <section className="settings-appearance-group" aria-labelledby="theme-heading">
        <div>
          <h3 id="theme-heading">主题</h3>
          <p>当前使用 {themeMode === "dark" ? "深色" : "浅色"} 主题</p>
        </div>
        <div className="settings-segmented" role="group" aria-label="主题">
          <ThemeButton mode="light" selected={themeMode} onSelect={setThemeMode} label="浅色" />
          <ThemeButton mode="dark" selected={themeMode} onSelect={setThemeMode} label="深色" />
        </div>
      </section>
    </SettingsSectionHeader>
  );
}

function ThemeButton({
  label,
  mode,
  onSelect,
  selected,
}: {
  label: string;
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
  selected: ThemeMode;
}): ReactElement {
  return (
    <button
      aria-pressed={selected === mode}
      type="button"
      onClick={() => onSelect(mode)}
    >
      {label}
    </button>
  );
}

function SettingsSectionHeader({
  action,
  bodyClassName,
  children,
  eyebrow,
  title,
}: {
  action?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  eyebrow: string;
  title: string;
}): ReactElement {
  return (
    <section className="settings-section" aria-labelledby={`settings-${title}`}>
      <header className="settings-section__header">
        <div className="settings-section__title-row">
          <h2 id={`settings-${title}`}>{title}</h2>
          <p className="settings-section__description">{eyebrow}</p>
        </div>
        {action ?? null}
      </header>
      <div className={`settings-section__body${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {children}
      </div>
    </section>
  );
}
