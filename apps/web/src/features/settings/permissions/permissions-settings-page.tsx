import {
  Bot,
  FolderOpen,
  FileCode2,
  Globe2,
  MonitorCog,
  Search,
  ShieldCheck,
  Shield,
  LockKeyhole,
  Terminal,
} from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { type ReactElement } from "react";
import { type ConversationPermissionMode } from "@agent/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { useApplicationSettingsStore } from "../../../stores/application-settings-store.js";
import { SettingsCategoryHeading } from "../components/settings-configuration-card.js";

export function PermissionsSettings(): ReactElement {
  const defaultPermissionMode = useApplicationSettingsStore((state) => state.defaultPermissionMode);
  const setDefaultPermissionMode = useApplicationSettingsStore((state) => state.setDefaultPermissionMode);
  const permissionPolicies = useApplicationSettingsStore((state) => state.permissionPolicies);
  const setPermissionPolicy = useApplicationSettingsStore((state) => state.setPermissionPolicy);
  const approvalReviewer = useApplicationSettingsStore((state) => state.approvalReviewer);
  const setApprovalReviewer = useApplicationSettingsStore((state) => state.setApprovalReviewer);

  return (
    <SettingsSectionHeader eyebrow="安全边界与审批" title="权限">
      <div className="settings-general-category">
        <SettingsCategoryHeading icon={ShieldCheck}>权限模式</SettingsCategoryHeading>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>新对话权限模式</h4>
              <p>影响之后新建的对话；已有对话保留各自的权限模式。</p>
            </div>
            <Select value={defaultPermissionMode === "ask_before_changes" ? approvalReviewer === "auto_review" ? "auto_review" : "request_approval" : defaultPermissionMode} onValueChange={(value) => setDefaultPermissionMode(value as ConversationPermissionMode)}>
              <SelectTrigger aria-label="新对话权限模式" className="settings-general-select"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                {defaultPermissionMode === "read_only" ? <SelectItem value="read_only" disabled>旧版只读</SelectItem> : null}
                <SelectItem value="request_approval">请求批准</SelectItem>
                <SelectItem value="auto_review">帮我批准</SelectItem>
                <SelectItem value="full_access">完全访问</SelectItem>
              </SelectContent>
            </Select>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>请求批准</h4>
              <p>文件、命令及联网操作按授权规则交给你确认，工作区外读取始终询问。</p>
            </div>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>帮我批准</h4>
              <p>自动审核原本需要审批的操作；高风险、判断不清或审核失败时仍交给你。</p>
            </div>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>完全访问</h4>
              <p>授权工作区内直接执行；路径边界、参数校验和危险操作保护仍然生效。</p>
            </div>
          </article>
        </div>
      </div>

      <div className="settings-general-category">
        <SettingsCategoryHeading icon={Bot}>默认审批处理方式</SettingsCategoryHeading>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>{approvalReviewer === "user" ? "由我确认" : "AI 帮我审批"}</h4>
              <p>
                {approvalReviewer === "user"
                  ? "未单独选择对话审批模式时，需要审批的操作交给你决定。"
                  : "未单独选择对话审批模式时，AI 审核原本需要审批的操作；高风险、判断不清或审核失败仍交给你。"}
              </p>
            </div>
            <div className="settings-segmented" role="group" aria-label="审批处理方式">
              <button
                aria-pressed={approvalReviewer === "user"}
                type="button"
                onClick={() => setApprovalReviewer("user")}
              >
                由我确认
              </button>
              <button
                aria-pressed={approvalReviewer === "auto_review"}
                type="button"
                onClick={() => setApprovalReviewer("auto_review")}
              >
                AI 帮我审批
              </button>
            </div>
          </article>
        </div>
      </div>

      <section className="settings-general-category" aria-labelledby="tool-policies-heading">
        <SettingsCategoryHeading id="tool-policies-heading" icon={Shield}>工具权限</SettingsCategoryHeading>
        <div className="settings-general-card">
          {([
            { id: "workspace-read", label: "文件读取", description: "读取授权工作区中的文件。", icon: FolderOpen },
            { id: "workspace-search", label: "工作区搜索", description: "查找文件、文本与代码内容。", icon: Search },
            { id: "patch-write", label: "文件修改", description: "写入、修改或删除工作区文件。", icon: FileCode2 },
            { id: "command-run", label: "命令与终端", description: "执行命令、创建和操作侧边终端。", icon: Terminal },
            { id: "browser-control", label: "浏览器操作", description: "打开页面、导航与浏览器交互。", icon: Globe2 },
            { id: "computer-control", label: "电脑控制", description: "仅操作电脑控制设置中授权的软件。", icon: MonitorCog },
          ] as const).map(({ id, label, description, icon: Icon }) => (
            <article key={id} className="settings-general-row">
              <div>
                <h4 className="flex items-center gap-2"><Icon aria-hidden="true" size={15} />{label}</h4>
                <p>{description}</p>
              </div>
              <Select value={permissionPolicies[id]} onValueChange={(value) => {
                if (value === "allow" || value === "ask" || value === "unavailable") setPermissionPolicy(id, value);
              }}>
                <SelectTrigger aria-label={`${label}权限`} className="settings-general-select"><SelectValue /></SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="allow">直接允许</SelectItem>
                  <SelectItem value="ask">请求审批</SelectItem>
                  <SelectItem value="unavailable">禁用</SelectItem>
                </SelectContent>
              </Select>
            </article>
          ))}
          <p className="px-4 pb-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">工具权限与对话权限模式共同生效；旧版只读状态仍禁止修改，禁用项、角色和工作区边界继续生效。</p>
        </div>
      </section>

      <div className="settings-general-category">
        <SettingsCategoryHeading icon={LockKeyhole}>审批范围</SettingsCategoryHeading>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>允许一次</h4>
              <p>只允许审批卡中这一条具体工具调用。</p>
            </div>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>本对话允许相同操作</h4>
              <p>只匹配完整命令或同一工具与路径，不会把一个 IP 自动扩大为所有 ping 命令。</p>
            </div>
          </article>
        </div>
      </div>
    </SettingsSectionHeader>
  );
}
