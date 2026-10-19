import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { type ReactElement } from "react";
import { type AgentClient } from "../../../runtime/index.js";
import { GlobalDefaultsSettings, GlobalDefaultModelPicker } from "./context-compression-settings.js";
import { useModelSettingsController } from "./use-model-settings-controller.js";
import { ModelProviderDirectory } from "./model-provider-directory.js";
import { ModelProviderConfiguration } from "./model-provider-configuration.js";
import { ProviderModelList } from "./provider-model-list.js";
import { ModelConnectionTestDialog } from "./model-connection-test-dialog.js";

export function ModelsSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const controller = useModelSettingsController({ agentClient });
  const {
    globalContextCompression,
    isDefaultModelSaving,
    isModelTestDialogOpen,
    setIsModelTestDialogOpen,
    deletingProviderId,
    status,
    handleGlobalContextCompressionChange,
    setDefaultModel,
  } = controller;
  return (
    <SettingsSectionHeader
      bodyClassName="settings-section__body--models"
      eyebrow="模型协议 · 供应商"
      title="模型配置"
    >
      <div className="settings-provider-manager">
        <ModelProviderDirectory controller={controller} />

        <div className="settings-provider-editor" inert={deletingProviderId !== null}>
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
          <div className="settings-provider-editor__body">
            <ModelProviderConfiguration controller={controller} />

            <ProviderModelList controller={controller} />

            {isModelTestDialogOpen ? (
              <div
                className="settings-model-test-dialog-backdrop"
                onClick={(event) => {
                  if (event.currentTarget === event.target) setIsModelTestDialogOpen(false);
                }}
              >
                <ModelConnectionTestDialog controller={controller} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SettingsSectionHeader>
  );
}
