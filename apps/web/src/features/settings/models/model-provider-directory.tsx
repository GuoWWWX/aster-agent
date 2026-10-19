import { ChevronLeft, ChevronRight, CirclePlus, Search } from "lucide-react";
import { type ReactElement } from "react";
import { IconButton } from "../../../components/ui/icon-button.js";
import { SettingsDirectoryDeleteButton } from "../components/settings-directory-delete-button.js";
import { ProviderLogo } from "../provider-logo.js";
import { connectionStatusLabel } from "./model-provider-state.js";
import type { ModelSettingsController } from "./use-model-settings-controller.js";

export function ModelProviderDirectory({ controller }: {
  controller: Pick<ModelSettingsController,
    | "setDiscoveredModels"
    | "setActiveProviderId"
    | "setIsApiKeyVisible"
    | "setOperationError"
    | "setProviderPage"
    | "providerSaveState"
    | "deletingProviderId"
    | "providerSearchQuery"
    | "setProviderSearchQuery"
    | "providers"
    | "normalizedProviderSearchQuery"
    | "filteredProviders"
    | "providerPageCount"
    | "currentProviderPage"
    | "pagedProviders"
    | "selectedProviderId"
    | "createProvider"
    | "deleteProvider"
  >;
}): ReactElement {
  const {
    setDiscoveredModels,
    setActiveProviderId,
    setIsApiKeyVisible,
    setOperationError,
    setProviderPage,
    providerSaveState,
    deletingProviderId,
    providerSearchQuery,
    setProviderSearchQuery,
    providers,
    normalizedProviderSearchQuery,
    filteredProviders,
    providerPageCount,
    currentProviderPage,
    pagedProviders,
    selectedProviderId,
    createProvider,
    deleteProvider,
  } = controller;
  return (
    <aside className="settings-provider-list" aria-label="供应商列表">
      <header className="settings-provider-list__heading">
        <strong>供应商</strong>
        <IconButton label="添加供应商" size="compact" disabled={deletingProviderId !== null} onClick={createProvider}>
          <CirclePlus aria-hidden="true" size={18} />
        </IconButton>
      </header>

      <div className="settings-provider-list__body">
        <label className="settings-provider-list__search app-search-field">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="搜索供应商"
            autoComplete="off"
            disabled={deletingProviderId !== null}
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
            <div key={provider.id} className="group/directory relative" data-active={provider.id === selectedProviderId}>
              <button
                aria-pressed={provider.id === selectedProviderId}
                className="settings-provider-list__item"
                disabled={deletingProviderId !== null}
                data-active={provider.id === selectedProviderId}
                type="button"
                onClick={() => {
                  setActiveProviderId(provider.id);
                  setIsApiKeyVisible(false);
                  setDiscoveredModels([]);
                  setOperationError(null);
                }}
              >
                <ProviderLogo
                  icon={provider.icon}
                  providerName={provider.name}
                  size="medium"
                />
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
              <SettingsDirectoryDeleteButton
                disabled={deletingProviderId !== null || providerSaveState === "pending" || providerSaveState === "saving"}
                label={`删除供应商 ${provider.name}`}
                onDelete={() => void deleteProvider(provider.id)}
              />
            </div>
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
  );
}
