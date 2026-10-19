import { Boxes, Eye, EyeOff } from "lucide-react";
import { type ReactElement } from "react";
import { type ModelApiFormat, isReasoningOptionSupportedByApiFormat } from "@agent/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { ProviderIconPicker } from "../provider-logo.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";
import { MODEL_API_FORMAT_OPTIONS, modelApiBaseUrlPlaceholder } from "./model-provider-state.js";
import type { ModelSettingsController } from "./use-model-settings-controller.js";

export function ModelProviderConfiguration({ controller }: {
  controller: Pick<ModelSettingsController,
    | "draft"
    | "setDraft"
    | "isApiKeyVisible"
    | "setIsApiKeyVisible"
    | "setConfiguredModelDrafts"
    | "updateDraft"
    | "markProviderConfigurationChanged"
  >;
}): ReactElement {
  const {
    draft,
    setDraft,
    isApiKeyVisible,
    setIsApiKeyVisible,
    setConfiguredModelDrafts,
    updateDraft,
    markProviderConfigurationChanged,
  } = controller;
  return (
    <SettingsConfigurationGroup cardAriaLabel="供应商基本配置" cardClassName="settings-provider-profile" icon={Boxes} title="基本配置">
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
        <div className="settings-provider-icon-field">
          <span>供应商图标</span>
          <ProviderIconPicker
            icon={draft.providerIcon}
            providerName={draft.providerName}
            onIconChange={(providerIcon) => {
              setDraft((current) => ({ ...current, providerIcon }));
              markProviderConfigurationChanged();
            }}
          />
        </div>
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
              placeholder="请输入或重新输入 API Key"
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
        <label className="settings-provider-fields__note">
          备注
          <input
            maxLength={500}
            name="providerNote"
            placeholder="填写供应商备注"
            value={draft.providerNote}
            onChange={updateDraft}
          />
        </label>
      </div>

    </SettingsConfigurationGroup>
  );
}
