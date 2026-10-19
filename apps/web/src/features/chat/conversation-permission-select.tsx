import type { ConversationPermissionMode } from "@agent/protocol";
import { ClipboardList, Hand, ShieldCheck, ShieldAlert } from "lucide-react";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../components/ui/select.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";

const modes = {
  read_only: { label: "规划", description: "只读分析与规划，不修改文件或执行写入操作。", icon: ClipboardList, color: "text-[var(--app-accent)]!" },
  request_approval: { label: "请求批准", description: "文件修改、命令和联网操作按授权规则交给你确认，工作区外读取始终询问。", icon: Hand, color: "text-[var(--app-accent)]!" },
  auto_review: { label: "帮我批准", description: "自动审核操作风险；低风险可继续，高风险、判断不清或审核失败时请你确认。", icon: ShieldCheck, color: "text-[var(--app-status-success-fg)]!" },
  full_access: { label: "完全访问", description: "直接执行已授权的文件、命令和网络操作；应用禁用项与系统边界仍生效。", icon: ShieldAlert, color: "text-[var(--app-status-warning-fg)]!" },
};

export function ConversationPermissionSelect({ value, disabled, deferred, onChange, busy = false }: {
  value: ConversationPermissionMode; disabled: boolean; deferred: boolean; onChange: (value: string) => void; busy?: boolean;
}) {
  const reviewer = useApplicationSettingsStore(state => state.approvalReviewer);
  const selectedMode = value === "ask_before_changes" ? reviewer === "auto_review" ? "auto_review" : "request_approval" : value;
  const selected = modes[selectedMode];
  const Icon = selected.icon;
  return <Select value={selectedMode} disabled={disabled || busy} onValueChange={onChange}>
    <TooltipAnchor side="top" content={`${selected.label}：${selected.description}${deferred ? " 已保存到团队工作项，将在下一次执行生效。" : ""}`}>
      <SelectTrigger aria-label="权限模式" aria-busy={busy || undefined} data-permission-mode={selectedMode} showIndicator={false}
        className={`conversation-workspace__composer-select conversation-workspace__composer-select--permission size-8! justify-center! px-0! ${selected.color} ${busy && !disabled ? "disabled:opacity-100!" : ""}`}>
        <Icon aria-hidden="true" size={16} />
      </SelectTrigger>
    </TooltipAnchor>
    <SelectContent align="start" className="w-[300px] max-w-[calc(100vw-20px)]" side="top">
      {(["request_approval", "auto_review", "full_access"] as const).map(mode => {
        const option = modes[mode]; const ModeIcon = option.icon;
        return <SelectItem key={mode} value={mode} className="h-auto min-h-12 py-2"><span className={`flex items-center gap-2 ${option.color}`}>
          <ModeIcon aria-hidden="true" size={16} className="shrink-0" /><span className="grid gap-0.5"><span>{option.label}</span>
            <span className="text-[length:var(--app-font-size-caption)] whitespace-normal font-normal text-[var(--app-muted-foreground)]">{option.description}</span></span>
        </span></SelectItem>;
      })}
    </SelectContent>
  </Select>;
}
