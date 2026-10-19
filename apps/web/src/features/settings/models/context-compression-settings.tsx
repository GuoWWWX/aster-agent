import { Bot, Braces, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  type ContextCompressionConfiguration,
  type ContextCompressionThreshold,
  type ModelProfile,
} from "@agent/protocol";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover.js";
import { type AgentClient } from "../../../runtime/index.js";
import { ModelProfilePicker } from "../model-profile-picker.js";
import { ProviderLogo } from "../provider-logo.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";

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

export function GlobalDefaultsSettings({
  agentClient,
  defaultModelPicker,
  onContextCompressionChange,
}: {
  agentClient: AgentClient;
  defaultModelPicker: ReactNode;
  onContextCompressionChange: (configuration: ContextCompressionConfiguration) => void;
}): ReactElement {
  return (
    <SettingsConfigurationGroup cardClassName="settings-global-configuration p-0" icon={SlidersHorizontal} title="全局配置">
      <div className="settings-global-configuration__body">
        {defaultModelPicker}
        <ContextCompressionSettings
          agentClient={agentClient}
          onConfigurationChange={onContextCompressionChange}
        />
      </div>
    </SettingsConfigurationGroup>
  );
}

export function ModelContextCompressionEditor({
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

export function GlobalDefaultModelPicker({
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
        <span className="flex items-center gap-2"><Bot aria-hidden="true" size={16} />默认模型</span>
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
            {selectedModel === undefined ? (
              <Bot aria-hidden="true" size={16} />
            ) : (
              <ProviderLogo
                icon={selectedModel.providerIcon}
                providerName={selectedModel.providerName}
                size="compact"
              />
            )}
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
        <span className="flex items-center gap-2"><Braces aria-hidden="true" size={16} />上下文自动压缩</span>
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
            : saveState === "failed"
              ? "更新失败"
              : null}
        </span>
      </div>
    </div>
  );
}
