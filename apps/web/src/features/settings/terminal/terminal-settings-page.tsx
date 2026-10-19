import { Braces, Eye, RefreshCw, Type, Terminal } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  DEFAULT_TERMINAL_CONFIGURATION,
  type TerminalConfiguration,
  type TerminalOutputEncoding,
  type TerminalShell,
  type RuntimePlatform,
  terminalConfigurationSchema,
} from "@agent/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { type AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { SettingsCategoryHeading } from "../components/settings-configuration-card.js";
import { useQueuedAutoSave } from "../use-queued-auto-save.js";
import { autoSaveStateLabel, errorMessage } from "../configuration-state.js";

const TERMINAL_OUTPUT_ENCODING_OPTIONS: readonly {
  label: string;
  value: TerminalOutputEncoding;
}[] = [
  { label: "自动（UTF-8 / GB18030）", value: "auto" },
  { label: "UTF-8", value: "utf-8" },
  { label: "GBK", value: "gbk" },
  { label: "GB18030", value: "gb18030" },
  { label: "UTF-16 LE", value: "utf-16le" },
];

const TERMINAL_FONT_PRESETS = [
  {
    label: "默认（匹配 Windows Terminal · 图标与 Emoji）",
    value: DEFAULT_TERMINAL_CONFIGURATION.fontFamily,
  },
  {
    label: "CodeNewRoman Nerd Font Mono",
    value: "'CodeNewRoman Nerd Font Mono', 'Cascadia Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
  },
  {
    label: "Cascadia Mono",
    value: "'Cascadia Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
  },
  {
    label: "JetBrains Mono",
    value: "'JetBrains Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
  },
  {
    label: "Consolas",
    value: "Consolas, 'Segoe UI Emoji', 'Microsoft YaHei UI', monospace",
  },
] as const;

export function TerminalSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const savedConfiguration = useWorkbenchUiStore((state) => state.terminalConfiguration);
  const setTerminalConfiguration = useWorkbenchUiStore(
    (state) => state.setTerminalConfiguration,
  );
  const [draft, setDraft] = useState<TerminalConfiguration>(savedConfiguration);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<RuntimePlatform>("win32");
  const [saveRevision, setSaveRevision] = useState(0);
  const draftRef = useRef(draft);
  const latestSaveRevisionRef = useRef(0);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let disposed = false;

    void Promise.all([
      agentClient.getTerminalConfiguration(),
      agentClient.getRuntimeInfo(),
    ])
      .then(([configuration, runtime]) => {
        if (disposed) return;
        setDraft(configuration);
        setPlatform(runtime.platform);
        setTerminalConfiguration(configuration);
      })
      .catch(() => {
        if (!disposed) setOperationError("无法读取终端配置");
      });

    return () => {
      disposed = true;
    };
  }, [agentClient, setTerminalConfiguration]);

  const updateDraft = useCallback((update: Partial<TerminalConfiguration>): void => {
    const next = { ...draftRef.current, ...update };
    draftRef.current = next;
    setDraft(next);
    setTerminalConfiguration(next);
    setOperationError(null);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
  }, [setTerminalConfiguration]);

  const autoSave = useQueuedAutoSave({
    revision: saveRevision,
    save: (next: TerminalConfiguration) => agentClient.saveTerminalConfiguration(next),
    validate: (next: TerminalConfiguration) => {
      const parsed = terminalConfigurationSchema.safeParse(next);
      return parsed.success ? parsed.data : null;
    },
    value: draft,
    onError: (reason) => setOperationError(errorMessage(reason)),
    onSaved: (configuration, revision) => {
      if (revision !== latestSaveRevisionRef.current) return;
      draftRef.current = configuration;
      setDraft(configuration);
      setTerminalConfiguration(configuration);
    },
  });

  const updateNumber = (
    field: "fontSize" | "lineHeight",
    minimum: number,
    maximum: number,
    value: number,
  ): void => {
    if (!Number.isFinite(value)) return;
    updateDraft({ [field]: Math.min(maximum, Math.max(minimum, value)) });
  };

  const shellOptions = terminalShellOptions(platform);

  return (
    <SettingsSectionHeader
      eyebrow="工作区"
      title="侧边终端"
    >
      <div className="grid gap-7">
        <section className="settings-general-category" aria-labelledby="terminal-startup-heading">
        <SettingsCategoryHeading id="terminal-startup-heading" icon={Terminal}>启动与 Shell</SettingsCategoryHeading>
        <div className="settings-terminal-grid">
          <label className="settings-field">
            <span>默认 Shell</span>
            <Select
              value={draft.shell}
              onValueChange={(shell) => {
                updateDraft({ shell: shell as TerminalShell });
              }}
            >
              <SelectTrigger aria-label="侧边终端默认 Shell" className="settings-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {shellOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="settings-field settings-field--wide">
            <span>{terminalShellLabel(draft.shell, platform)}启动路径（可选）</span>
            <input
              aria-label="终端启动路径"
              placeholder="例如 C:\\Program Files\\PowerShell\\7\\pwsh.exe"
              value={draft.shellPaths[resolvedTerminalShell(draft.shell, platform)]}
              onChange={(event) => {
                const shell = resolvedTerminalShell(draft.shell, platform);
                updateDraft({
                  shellPaths: {
                    ...draftRef.current.shellPaths,
                    [shell]: event.target.value,
                  },
                });
              }}
            />
          </label>

        </div>
        <p className="settings-terminal-status mt-2">仅影响之后新建的侧边终端。启动路径留空时使用默认命令；PWSH 会尝试常见安装目录。</p>
        </section>

        <section className="settings-general-category" aria-labelledby="terminal-output-heading">
        <SettingsCategoryHeading id="terminal-output-heading" icon={Braces}>命令输出</SettingsCategoryHeading>
        <div className="settings-terminal-grid">
          <label className="settings-field">
            <span>一次性命令输出字符集</span>
            <Select
              value={draft.outputEncoding}
              onValueChange={(outputEncoding) => {
                updateDraft({
                  outputEncoding: outputEncoding as TerminalOutputEncoding,
                });
              }}
            >
              <SelectTrigger aria-label="输出字符集" className="settings-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {TERMINAL_OUTPUT_ENCODING_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

        </div>
        <p className="settings-terminal-status mt-2">用于 AI 一次性命令的结果解码，侧边终端的交互输出保持原有编码。</p>
        </section>

        <section className="settings-general-category" aria-labelledby="terminal-font-heading">
        <SettingsCategoryHeading id="terminal-font-heading" icon={Type}>字体与排版</SettingsCategoryHeading>
        <div className="settings-terminal-grid">
          <label className="settings-field settings-field--wide">
            <span>字体预设</span>
            <Select
              value={terminalFontPresetValue(draft.fontFamily)}
              onValueChange={(fontFamily) => {
                if (fontFamily !== "custom") updateDraft({ fontFamily });
              }}
            >
              <SelectTrigger aria-label="终端字体预设" className="settings-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {TERMINAL_FONT_PRESETS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义（使用下方字体栈）</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="settings-field settings-field--wide">
            <span>自定义字体栈</span>
            <input
              aria-label="终端自定义字体"
              value={draft.fontFamily}
              onChange={(event) => {
                updateDraft({ fontFamily: event.target.value });
              }}
            />
          </label>

          <label className="settings-field">
            <span>字号</span>
            <input
              aria-label="终端字号"
              max={28}
              min={10}
              step={1}
              type="number"
              value={draft.fontSize}
              onChange={(event) =>
                updateNumber("fontSize", 10, 28, event.currentTarget.valueAsNumber)
              }
            />
          </label>

          <label className="settings-field">
            <span>行高</span>
            <input
              aria-label="终端行高"
              max={2.2}
              min={1}
              step={0.05}
              type="number"
              value={draft.lineHeight}
              onChange={(event) =>
                updateNumber("lineHeight", 1, 2.2, event.currentTarget.valueAsNumber)
              }
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="settings-terminal-status">字体、字号和行高应用于之后新建的侧边终端。</p>
          <button className="settings-secondary-button" type="button" onClick={() => updateDraft({
            fontFamily: DEFAULT_TERMINAL_CONFIGURATION.fontFamily,
            fontSize: DEFAULT_TERMINAL_CONFIGURATION.fontSize,
            lineHeight: DEFAULT_TERMINAL_CONFIGURATION.lineHeight,
          })}><RefreshCw aria-hidden="true" size={14} />恢复默认排版</button>
        </div>
        </section>

        <section className="settings-general-category" aria-labelledby="terminal-preview-heading">
        <SettingsCategoryHeading id="terminal-preview-heading" icon={Eye}>效果预览</SettingsCategoryHeading>
        <section
          aria-label="终端预览"
          className="settings-terminal-preview"
          style={{
            fontFamily: draft.fontFamily,
            fontSize: `${draft.fontSize}px`,
            lineHeight: draft.lineHeight,
          }}
        >
          <header>
            <span>{terminalShellLabel(draft.shell, platform)}</span>
            <span>侧边终端</span>
          </header>
          <pre>
            <code>
              <span>$</span> Write-Output "中文输出"
              {"\n\n中文输出"}
            </code>
          </pre>
        </section>
        </section>

        {operationError !== null ? (
          <p className="settings-terminal-status" role="alert">{operationError}</p>
        ) : autoSave.state === "idle" ? null : (
          <p className="settings-terminal-status" role="status">
            {autoSaveStateLabel(autoSave.state)}
          </p>
        )}
      </div>
    </SettingsSectionHeader>
  );
}

function terminalShellOptions(
  platform: RuntimePlatform,
): readonly { label: string; value: TerminalShell }[] {
  if (platform === "win32") {
    return [
      { label: "系统默认（Windows PowerShell）", value: "system" },
      { label: "Windows PowerShell", value: "powershell" },
      { label: "PWSH（PowerShell 7）", value: "pwsh" },
      { label: "命令提示符", value: "cmd" },
    ];
  }

  return [
    { label: "系统默认（PowerShell 7）", value: "system" },
    { label: "PWSH（PowerShell 7）", value: "pwsh" },
    { label: "Bash", value: "bash" },
  ];
}

function terminalShellLabel(shell: TerminalShell, platform: RuntimePlatform): string {
  return terminalShellOptions(platform).find((option) => option.value === shell)?.label
    ?? "系统默认";
}

function terminalFontPresetValue(fontFamily: string): string {
  return TERMINAL_FONT_PRESETS.some((option) => option.value === fontFamily)
    ? fontFamily
    : "custom";
}

function resolvedTerminalShell(
  shell: TerminalShell,
  platform: RuntimePlatform,
): Exclude<TerminalShell, "system"> {
  if (shell !== "system") return shell;
  return platform === "win32" ? "powershell" : "pwsh";
}
