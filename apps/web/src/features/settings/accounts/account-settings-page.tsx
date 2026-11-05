import type { ReactElement } from "react";
import type { AgentClient } from "../../../runtime/index.js";
import { rememberModelStatus } from "../../../runtime/model-status-cache.js";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { ProviderAccountsPanel } from "./provider-accounts-panel.js";

export function AccountSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  return (
    <SettingsSectionHeader title="账号管理" eyebrow="授权账号">
      <div aria-label="授权账号管理" className="grid min-w-0 gap-[5px]">
        <ProviderAccountsPanel agentClient={agentClient} onModelsChanged={(status) => { rememberModelStatus(agentClient, status); }} />
      </div>
    </SettingsSectionHeader>
  );
}
