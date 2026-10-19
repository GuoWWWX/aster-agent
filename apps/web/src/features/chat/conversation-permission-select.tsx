import type { ConversationPermissionMode } from "@agent/protocol";
import { ClipboardList, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../components/ui/select.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";

const modes = {
  read_only: { label: "规划", description: "只读分析与规划，不修改文件或执行写入操作。", icon: ClipboardList, color: "text-[var(--app-accent)]!" },
  ask_before_changes: { label: "请求审批", description: "按权限配置请求批准后，执行文件修改或命令等操作。", icon: ShieldQuestion, color: "text-[var(--app-status-success-fg)]!" },
  full_access: { label: "完全访问", description: "自动执行文件、命令及网络操作，无需逐项审批。", icon: ShieldCheck, color: "text-[var(--app-status-warning-fg)]!" },
};

export function ConversationPermissionSelect({ value, disabled, deferred, onChange }: {
  value: ConversationPermissionMode; disabled: boolean; deferred: boolean; onChange: (value: string) => void;
}) {
  const selected = modes[value];
  const Icon = selected.icon;
  return <Select value={value} disabled={disabled} onValueChange={onChange}>
    <TooltipAnchor side="top" content={`${selected.label}：${selected.description}${deferred ? " 已保存到团队工作项，将在下一次执行生效。" : ""}`}>
      <SelectTrigger aria-label="权限模式" data-permission-mode={value} showIndicator={false}
        className={`conversation-workspace__composer-select conversation-workspace__composer-select--permission size-8! justify-center! px-0! ${selected.color}`}>
        <Icon aria-hidden="true" size={16} />
      </SelectTrigger>
    </TooltipAnchor>
    <SelectContent align="start" className="w-[300px] max-w-[calc(100vw-20px)]" side="top">
      {(Object.keys(modes) as ConversationPermissionMode[]).map(mode => {
        const option = modes[mode]; const ModeIcon = option.icon;
        return <SelectItem key={mode} value={mode} className="h-auto min-h-12 py-2"><span className={`flex items-center gap-2 ${option.color}`}>
          <ModeIcon aria-hidden="true" size={16} className="shrink-0" /><span className="grid gap-0.5"><span>{option.label}</span>
            <span className="text-[length:var(--app-font-size-caption)] whitespace-normal font-normal text-[var(--app-muted-foreground)]">{option.description}</span></span>
        </span></SelectItem>;
      })}
    </SelectContent>
  </Select>;
}
