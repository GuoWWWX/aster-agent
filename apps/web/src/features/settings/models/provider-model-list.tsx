import { isImageGenerationModel } from "@agent/protocol";
import { Spinner } from "../../../components/ui/loading.js";
import { Bot, Check, ChevronDown, CirclePlus, RefreshCw, TestTube2, Trash2 } from "lucide-react";
import { type ReactElement } from "react";
import { isReasoningOptionEnabled } from "@agent/protocol";
import { IconButton } from "../../../components/ui/icon-button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover.js";
import { ModelReasoningOptionsEditor } from "../model-reasoning-options-editor.js";
import { parseModelContextWindow } from "../model-context-window.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";
import { reasoningOptionLabel } from "../model-reasoning-options.js";
import { connectionStatusLabel } from "./model-provider-state.js";
import { ReasoningOptionsSummary } from "./reasoning-options-summary.js";
import { ModelContextCompressionEditor } from "./context-compression-settings.js";
import { ModelIdPicker } from "./model-id-picker.js";
import type { ModelSettingsController } from "./use-model-settings-controller.js";

export function ProviderModelList({ controller }: {
  controller: Pick<ModelSettingsController,
    | "discoveredModels"
    | "draft"
    | "isDiscovering"
    | "configuredModelDrafts"
    | "setConfiguredModelDrafts"
    | "expandedModelIds"
    | "setExpandedModelIds"
    | "isGlobalContextCompressionLoaded"
    | "editingReasoningModelId"
    | "setEditingReasoningModelId"
    | "modelTestResults"
    | "operationError"
    | "providerSaveState"
    | "modelCatalog"
    | "selectedProviderId"
    | "savedProviderModels"
    | "hasValidConfiguredModels"
    | "testableModels"
    | "isAnyModelTesting"
    | "setReasoningOptions"
    | "setContextWindow"
    | "setModelContextCompression"
    | "updateModelId"
    | "updateDisplayName"
    | "addModel"
    | "removeModel"
    | "markProviderConfigurationChanged"
    | "discoverModels"
    | "openModelTestDialog"
    | "testModelConnection"
  >;
}): ReactElement {
  const {
    discoveredModels,
    draft,
    isDiscovering,
    configuredModelDrafts,
    setConfiguredModelDrafts,
    expandedModelIds,
    setExpandedModelIds,
    isGlobalContextCompressionLoaded,
    editingReasoningModelId,
    setEditingReasoningModelId,
    modelTestResults,
    operationError,
    providerSaveState,
    modelCatalog,
    selectedProviderId,
    savedProviderModels,
    hasValidConfiguredModels,
    testableModels,
    isAnyModelTesting,
    setReasoningOptions,
    setContextWindow,
    setModelContextCompression,
    updateModelId,
    updateDisplayName,
    addModel,
    removeModel,
    markProviderConfigurationChanged,
    discoverModels,
    openModelTestDialog,
    testModelConnection,
  } = controller;
  return (
    <SettingsConfigurationGroup cardAriaLabel="模型列表" cardClassName="settings-provider-models" icon={Bot} title="模型列表">
      <div className="settings-provider-models__heading">
        <div className="settings-provider-models__heading-copy">
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
            disabled={
              testableModels.length === 0
              || selectedProviderId === null
              || !hasValidConfiguredModels
              || isAnyModelTesting
              || providerSaveState === "incomplete"
              || providerSaveState === "pending"
              || providerSaveState === "saving"
            }
            title={testableModels.length === 0 ? "请先配置模型 ID" : "选择要测试的模型"}
            type="button"
            onClick={openModelTestDialog}
          >
            <TestTube2 aria-hidden="true" size={15} />
            测试模型
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
            const testResult = modelTestResults[model.modelId];
            const isTestingModel = testResult?.kind === "testing";
            const connectionStatus = testResult?.kind === "success"
              ? "healthy"
              : testResult?.kind === "failed"
                ? "error"
                : savedProviderModels.find((candidate) =>
                  candidate.modelId === model.modelId
                )?.connectionStatus ?? "unknown";
            const enabledReasoningOptions = model.reasoningOptions.filter(isReasoningOptionEnabled);
            const reasoningSummary = enabledReasoningOptions.length === 0
              ? "自动"
              : enabledReasoningOptions.map(reasoningOptionLabel).join("，");
            return (
              <details
                key={model.id}
                className="settings-model-disclosure"
                role="listitem"
                open={expandedModelIds.includes(model.id)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  setExpandedModelIds((current) => {
                    if (current.includes(model.id) === isOpen) return current;
                    return isOpen ? [...current, model.id] : current.filter((id) => id !== model.id);
                  });
                }}
              >
                <summary>
                  {isTestingModel ? (
                    <span
                      aria-label="正在测试"
                      className="settings-model-connection-status"
                      data-state="testing"
                      title="正在测试"
                    />
                  ) : (
                    <span
                      aria-label={connectionStatusLabel(connectionStatus)}
                      className="settings-model-connection-status"
                      data-state={connectionStatus}
                      title={connectionStatusLabel(connectionStatus)}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={model.displayName || model.modelId || "未配置模型"}>
                    {model.displayName || model.modelId || "未配置模型"}
                    {isImageGenerationModel(model) ? <span className="ml-2 text-[length:var(--app-font-size-caption)] text-[var(--app-accent)]">生图</span> : null}
                  </span>
                  <span className="min-w-0 max-w-[40%] truncate text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
                    {model.modelId || "点击配置模型参数"}
                    {model.contextWindow === "" ? null : ` · ${model.contextWindow}`}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-0.5">
                    <IconButton
                      label={`测试 ${model.displayName || model.modelId || "模型"}`}
                      tooltip="连通测试"
                      disabled={selectedProviderId === null || model.modelId.trim().length === 0
                        || providerSaveState === "pending" || providerSaveState === "saving"
                        || providerSaveState === "incomplete" || isAnyModelTesting}
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); void testModelConnection(model.modelId); }}
                    >
                      {isTestingModel ? <Spinner aria-hidden="true" size={15} /> : <TestTube2 aria-hidden="true" size={15} />}
                    </IconButton>
                    <IconButton
                      label={`删除 ${model.displayName || model.modelId || "模型"}`}
                      tooltip={configuredModelDrafts.length === 1 ? "供应商至少保留一个模型" : "删除模型"}
                      disabled={configuredModelDrafts.length === 1}
                      variant="destructive"
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeModel(model.id); }}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </IconButton>
                  </span>
                </summary>
                <div className="settings-model-option">
                  <Select value={isImageGenerationModel(model) ? "image" : "chat"}
                    onValueChange={value => { setConfiguredModelDrafts(current => current.map(item => item.id === model.id ? { ...item, modelType: value === "image" ? "image" : "chat" } : item)); markProviderConfigurationChanged(); }}>
                    <SelectTrigger aria-label={`${model.modelId || "模型"}的用途`} className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="chat">对话</SelectItem><SelectItem value="image">生图</SelectItem></SelectContent>
                  </Select>
                  <label className="settings-model-field settings-model-field--name">
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
                        catalog={modelCatalog}
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
                        title="上下文窗口：不带单位为 Token，支持 K、M（如 128K、1.5M）"
                        aria-invalid={parseModelContextWindow(model.contextWindow) === null || undefined}
                        placeholder="Token / K / M"
                        type="text"
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

                  {testResult?.kind === "failed" ? (
                    <p className="settings-model-test-feedback" data-state="failed" role="alert">
                      测试失败：{testResult.message}
                    </p>
                  ) : testResult?.kind === "success" ? (
                    <p className="settings-model-test-feedback" data-state="success" role="status">
                      <Check aria-hidden="true" size={13} />
                      连接正常：{testResult.content}
                    </p>
                  ) : null}

                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="settings-empty-state">添加模型后输入模型 ID；获取模型后可从右侧下拉选择。</p>
      )}

      {operationError !== null ? <p className="settings-operation-error" role="alert">{operationError}</p> : null}
      {providerSaveState === "pending" || providerSaveState === "saving" || providerSaveState === "incomplete" ? (
        <footer className="settings-provider-editor__footer">
          <p>
            {providerSaveState === "pending"
              ? "等待更新"
              : providerSaveState === "saving"
                ? "正在更新"
                : "请完成供应商和模型配置"}
          </p>
        </footer>
      ) : null}
    </SettingsConfigurationGroup>
  );
}
