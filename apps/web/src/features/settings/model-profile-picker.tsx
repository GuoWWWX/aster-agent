import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowDownZA,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListOrdered,
  Search,
} from "lucide-react";
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
import { IconButton } from "../../components/ui/icon-button.js";
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

type ModelProfileSortOption = "default" | "name-ascending" | "name-descending";

const MODEL_PROFILE_SORT_OPTIONS: readonly {
  label: string;
  value: ModelProfileSortOption;
}[] = [
  { label: "默认顺序", value: "default" },
  { label: "名称 A-Z", value: "name-ascending" },
  { label: "名称 Z-A", value: "name-descending" },
];

const modelProfileNameCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

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
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<ModelProfileSortOption>("default");
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
  const sortedGroups = useMemo(() => sortProviderGroups(filteredGroups, sortOption), [
    filteredGroups,
    sortOption,
  ]);
  const canToggleAllProviders = normalizedQuery.length === 0 && sortedGroups.length > 0;
  const allProvidersCollapsed = canToggleAllProviders && sortedGroups.every((provider) =>
    collapsedProviderIds.has(provider.id),
  );
  const sortLabel = MODEL_PROFILE_SORT_OPTIONS.find((option) => option.value === sortOption)?.label
    ?? "默认顺序";

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
        <div className="model-profile-picker__toolbar">
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
          <span aria-hidden="true" className="model-profile-picker__toolbar-divider" />
          <Popover open={sortOpen} onOpenChange={setSortOpen}>
            <PopoverTrigger asChild>
              <IconButton
                label={`排序：${sortLabel}`}
                size="compact"
                variant="quiet"
              >
                <ArrowDownUp aria-hidden="true" size={15} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="model-profile-picker__sort-menu"
              collisionPadding={8}
              side="bottom"
              sideOffset={4}
            >
              <p>排序方式</p>
              <div role="menu">
                {MODEL_PROFILE_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    aria-checked={option.value === sortOption}
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setSortOption(option.value);
                      setSortOpen(false);
                    }}
                  >
                    <span className="model-profile-picker__sort-option">
                      {option.value === "default" ? (
                        <ListOrdered aria-hidden="true" size={14} />
                      ) : option.value === "name-ascending" ? (
                        <ArrowDownAZ aria-hidden="true" size={14} />
                      ) : (
                        <ArrowDownZA aria-hidden="true" size={14} />
                      )}
                      {option.label}
                    </span>
                    {option.value === sortOption ? <Check aria-hidden="true" size={14} /> : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <IconButton
            disabled={!canToggleAllProviders}
            label={allProvidersCollapsed ? "全部展开供应商模型" : "全部收起供应商模型"}
            size="compact"
            variant="quiet"
            onClick={() => {
              setCollapsedProviderIds(allProvidersCollapsed
                ? new Set()
                : new Set(providerGroups.map((provider) => provider.id)));
            }}
          >
            {allProvidersCollapsed ? (
              <ChevronsUpDown aria-hidden="true" size={15} />
            ) : (
              <ChevronsDownUp aria-hidden="true" size={15} />
            )}
          </IconButton>
        </div>
        <div className="model-profile-picker__options" role="listbox" aria-label={ariaLabel}>
          {sortedGroups.map((provider) => {
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
                        size="small"
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
                      <span className="model-profile-picker__option-leading">
                        <span
                          aria-label={connectionStatusLabel(model.connectionStatus)}
                          className="model-profile-picker__connection-status"
                          data-status={model.connectionStatus}
                          role="img"
                          title={connectionStatusLabel(model.connectionStatus)}
                        />
                        <span className="model-profile-picker__option-identity">
                          <strong>{model.displayName}</strong>
                        </span>
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
          {sortedGroups.length === 0 ? (
            <p className="model-profile-picker__empty">没有匹配的供应商或模型</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sortProviderGroups(
  groups: readonly ProviderModelGroup[],
  option: ModelProfileSortOption,
): ProviderModelGroup[] {
  if (option === "default") return [...groups];
  const multiplier = option === "name-ascending" ? 1 : -1;
  return groups
    .map((provider) => ({
      ...provider,
      models: [...provider.models].sort((left, right) => multiplier * modelProfileNameCollator.compare(
        left.displayName || left.modelId,
        right.displayName || right.modelId,
      )),
    }))
    .sort((left, right) => multiplier * modelProfileNameCollator.compare(left.name, right.name));
}

function connectionStatusLabel(status: ModelProfile["connectionStatus"]): string {
  if (status === "healthy") return "连接正常";
  if (status === "error") return "连接异常";
  return "未测试";
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
