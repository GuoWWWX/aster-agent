import { Check, ChevronRight, Search } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type {
  ContextCompressionThreshold,
  ModelProfile,
  ModelProviderIcon,
} from "@agent/protocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { cn } from "../../lib/cn.js";
import { ProviderLogo } from "./provider-logo.js";
import "./model-profile-picker.css";

type ProviderModelGroup = {
  baseUrl: string;
  id: string;
  icon: ModelProviderIcon;
  models: ModelProfile[];
  name: string;
};

export function ModelProfilePicker({
  align = "start",
  ariaLabel,
  className,
  defaultContextCompression,
  models,
  selectedModelId,
  selectedProviderId,
  side = "bottom",
  trigger,
  onSelect,
}: {
  align?: "center" | "end" | "start";
  ariaLabel: string;
  className?: string;
  defaultContextCompression: ContextCompressionThreshold;
  models: readonly ModelProfile[];
  selectedModelId: string | null;
  selectedProviderId: string | null;
  side?: "bottom" | "left" | "right" | "top";
  trigger: ReactElement;
  onSelect: (model: ModelProfile) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProviderIds, setCollapsedProviderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const providerGroups = useMemo(() => {
    const groups = new Map<string, ProviderModelGroup>();
    for (const model of models) {
      const existing = groups.get(model.providerId);
      if (existing !== undefined) {
        existing.models.push(model);
      } else {
        groups.set(model.providerId, {
          baseUrl: model.providerBaseUrl,
          id: model.providerId,
          icon: model.providerIcon ?? "auto",
          models: [model],
          name: model.providerName,
        });
      }
    }
    return [...groups.values()];
  }, [models]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredGroups = providerGroups.flatMap((provider) => {
    const matchesProvider = normalizedQuery.length === 0 || [provider.name, provider.baseUrl]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    const filteredModels = matchesProvider
      ? provider.models
      : provider.models.filter((model) => [model.displayName, model.modelId]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
    return filteredModels.length === 0 ? [] : [{ ...provider, models: filteredModels }];
  });

  return (
    <Popover
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) setSearchQuery("");
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("model-profile-picker", className)}
        collisionPadding={8}
        side={side}
        sideOffset={5}
      >
        <label className="model-profile-picker__search app-search-field">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="搜索模型"
            autoFocus
            placeholder="搜索供应商、地址、模型 ID 或名称"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="model-profile-picker__options" role="listbox" aria-label={ariaLabel}>
          {filteredGroups.map((provider) => {
            const isCollapsed = collapsedProviderIds.has(provider.id);
            return (
              <section
                key={provider.id}
                aria-label={provider.name}
                className="model-profile-picker__provider"
                role="group"
              >
                <header>
                  <button
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "展开" : "收起"} ${provider.name}`}
                    className="model-profile-picker__provider-toggle"
                    type="button"
                    onClick={() => {
                      setCollapsedProviderIds((current) => {
                        const next = new Set(current);
                        if (isCollapsed) next.delete(provider.id);
                        else next.add(provider.id);
                        return next;
                      });
                    }}
                  >
                    <span className="model-profile-picker__provider-name">
                      <ChevronRight aria-hidden="true" size={13} />
                      <ProviderLogo
                        icon={provider.icon}
                        providerName={provider.name}
                        size="compact"
                      />
                      {provider.name}
                    </span>
                  </button>
                  <a
                    aria-label={`打开供应商地址 ${provider.baseUrl}`}
                    className="model-profile-picker__provider-url"
                    href={provider.baseUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={provider.baseUrl}
                  >
                    {provider.baseUrl}
                  </a>
                </header>
                {isCollapsed ? null : provider.models.map((model) => {
                  const isSelected =
                    model.providerId === selectedProviderId
                    && model.modelId === selectedModelId;
                  const contextCompression =
                    model.contextCompression ?? defaultContextCompression;
                  return (
                    <button
                      key={`${model.providerId}:${model.modelId}`}
                      aria-selected={isSelected}
                      className="model-profile-picker__option"
                      data-selected={isSelected}
                      role="option"
                      type="button"
                      onClick={() => {
                        onSelect(model);
                        setIsOpen(false);
                      }}
                    >
                      <span className="model-profile-picker__option-identity">
                        <strong>{model.displayName}</strong>
                        <small>{model.modelId}</small>
                      </span>
                      <span className="model-profile-picker__option-side">
                        <span className="model-profile-picker__option-metrics">
                          <small title="压缩阈值">
                            阈值 {compressionThresholdLabel(contextCompression)}
                          </small>
                          <small title="上下文大小">
                            上下文 {compactTokenCount(model.contextWindow)}
                          </small>
                        </span>
                        <span className="model-profile-picker__option-check">
                          {isSelected ? <Check aria-hidden="true" size={16} /> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
          {filteredGroups.length === 0 ? (
            <p className="model-profile-picker__empty">没有匹配的供应商或模型</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function compressionThresholdLabel(configuration: ContextCompressionThreshold): string {
  return configuration.mode === "percentage"
    ? `${configuration.percentageThreshold}%`
    : compactTokenCount(configuration.tokenThreshold);
}

function compactTokenCount(tokenCount: number): string {
  if (tokenCount <= 0) return "未配置";
  if (tokenCount < 1_000) return String(tokenCount);
  const divisor = tokenCount >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? "M" : "K";
  const value = tokenCount / divisor;
  return `${Number(value.toFixed(value >= 10 ? 1 : 2))}${suffix}`;
}
