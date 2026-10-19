import { Archive, Boxes, Globe2, MonitorCog, PlugZap, Search, ShieldCheck, Sparkles, SlidersHorizontal, Terminal, UsersRound, type LucideIcon } from "lucide-react";
import { ModelReasoningCatalogSettings } from "./model-reasoning-catalog-settings.js";
import { ComputerUseSettings } from "./computer-use-settings.js";
import { useEffect, useRef, useState, type ReactElement, type CSSProperties } from "react";
import { ResizableDivider } from "../../components/layout/resizable-divider.js";
import { type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore, SETTINGS_NAVIGATION_WIDTH_RANGE, type SettingsSection } from "../../stores/workbench-ui-store.js";
import { matchesSettingsQuery, SETTINGS_SEARCH_ITEMS, type SettingsSearchItem } from "./settings-search.js";
import { AgentTeamSettings } from "./agent-team-settings.js";
import "./settings-workspace.css";
import { GeneralSettings } from "./general/general-settings-page.js";
import { ModelsSettings } from "./models/model-settings-page.js";
import { McpSettings } from "./mcp/mcp-settings-page.js";
import { SkillsSettings } from "./skills/skill-settings-page.js";
import { ArchivedConversationsSettings } from "./archived/archived-conversations-settings-page.js";
import { PermissionsSettings } from "./permissions/permissions-settings-page.js";
import { BrowserSettings } from "./browser/browser-settings-page.js";
import { TerminalSettings } from "./terminal/terminal-settings-page.js";
import { AppearanceSettings } from "./appearance/appearance-settings-page.js";

type SettingsNavItem = {
  icon: LucideIcon;
  id: SettingsSection;
  label: string;
  group: string;
};

const SETTINGS_NAVIGATION: readonly SettingsNavItem[] = [
  { id: "general", label: "常规设置", icon: SlidersHorizontal, group: "应用" },
  { id: "appearance", label: "外观", icon: MonitorCog, group: "应用" },
  { id: "permissions", label: "权限", icon: ShieldCheck, group: "应用" },
  { id: "models", label: "模型配置", icon: Boxes, group: "智能体" },
  { id: "reasoning", label: "推理程度", icon: SlidersHorizontal, group: "智能体" },
  { id: "agents", label: "Agent 与团队", icon: UsersRound, group: "智能体" },
  { id: "mcp", label: "MCP", icon: PlugZap, group: "集成" },
  { id: "skills", label: "Skill", icon: Sparkles, group: "集成" },
  { id: "browser", label: "浏览器", icon: Globe2, group: "工作区" },
  { id: "computer-use", label: "电脑控制", icon: MonitorCog, group: "工作区" },
  { id: "terminal", label: "终端", icon: Terminal, group: "工作区" },
  { id: "archived", label: "已归档对话", icon: Archive, group: "数据" },
];

export function SettingsWorkspace({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [navigationQuery, setNavigationQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<SettingsSearchItem | null>(null);
  const [locatedTarget, setLocatedTarget] = useState<SettingsSearchItem | null>(null);
  const filteredNavigation = SETTINGS_NAVIGATION.filter((item) => (
    matchesSettingsQuery(navigationQuery, item.label)
  ));
  const searchResults = navigationQuery.trim() === "" ? [] : SETTINGS_SEARCH_ITEMS.filter((item) => (
    matchesSettingsQuery(navigationQuery, item.label, item.keywords ?? "", SETTINGS_NAVIGATION.find((section) => section.id === item.section)?.label ?? "")
  ));
  const activeSection = useWorkbenchUiStore((state) => state.settingsSection);
  const setActiveSection = useWorkbenchUiStore((state) => state.setSettingsSection);
  const navigationWidth = useWorkbenchUiStore((state) => state.settingsNavigationWidth);
  const setNavigationWidth = useWorkbenchUiStore((state) => state.setSettingsNavigationWidth);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (content === null || searchTarget === null || searchTarget.section !== activeSection) return;
    let highlighted: HTMLElement | null = null;
    let previousTabIndex: string | null = null;
    const locate = (): boolean => {
      const target = content.querySelector<HTMLElement>(searchTarget.selector);
      if (target === null) return false;
      highlighted = target.closest<HTMLElement>(".settings-general-row, .settings-field, label") ?? target;
      previousTabIndex = highlighted.getAttribute("tabindex");
      highlighted.setAttribute("data-settings-search-highlight", "true");
      highlighted.setAttribute("tabindex", "-1");
      highlighted.scrollIntoView?.({ block: "center", behavior: "instant" });
      highlighted.focus({ preventScroll: true });
      setLocatedTarget(searchTarget);
      return true;
    };
    // Configuration pages load asynchronously; locate once the requested field mounts.
    const observer = new MutationObserver(() => { if (locate()) observer.disconnect(); });
    if (!locate()) observer.observe(content, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (highlighted === null) return;
      highlighted.removeAttribute("data-settings-search-highlight");
      if (previousTabIndex === null) highlighted.removeAttribute("tabindex");
      else highlighted.setAttribute("tabindex", previousTabIndex);
    };
  }, [activeSection, searchTarget]);

  const maximumWidth = availableWidth === null ? SETTINGS_NAVIGATION_WIDTH_RANGE.max
    : Math.max(SETTINGS_NAVIGATION_WIDTH_RANGE.min, Math.min(SETTINGS_NAVIGATION_WIDTH_RANGE.max, availableWidth - 520));
  const displayedWidth = Math.min(navigationWidth, maximumWidth);

  return (
    <section className="settings-workspace" aria-labelledby="settings-workspace-heading">
      <div ref={workspaceRef} className="settings-workspace__body" style={{ "--settings-navigation-width": `${displayedWidth}px` } as CSSProperties}>
        <nav className="settings-navigation rounded-[var(--app-radius)]" aria-label="设置分区">
          <h1 id="settings-workspace-heading" className="m-0 mb-4 px-2 text-[length:var(--app-font-size-display)] font-semibold text-[var(--app-foreground)]">设置</h1>
          <label className="settings-navigation__search app-search-field mx-2 mb-4 shrink-0">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="搜索设置"
              placeholder="搜索设置"
              value={navigationQuery}
              onChange={(event) => { setNavigationQuery(event.target.value); setSearchTarget(null); }}
            />
          </label>
          <div className="settings-navigation__items">
            {[...new Set(filteredNavigation.map((item) => item.group))].map((group) => (
              <section key={group} className="mb-4 last:mb-0" aria-label={group}>
                <h2 className="m-0 mb-1 px-2 text-[length:var(--app-font-size-auxiliary)] font-medium text-[var(--app-subtle-foreground)]">{group}</h2>
                {filteredNavigation.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeSection;

              return (
                <button
                  key={item.id}
                  aria-current={isActive ? "page" : undefined}
                  className="settings-navigation__item"
                  data-active={isActive}
                  type="button"
                  onClick={() => { setSearchTarget(null); setActiveSection(item.id); }}
                >
                  <Icon aria-hidden="true" size={16} />
                  <span>{item.label}</span>
                </button>
              );
                })}
              </section>
            ))}
            {searchResults.length > 0 ? (
              <section aria-label="配置项搜索结果">
                <h2 className="m-0 mb-1 px-2 text-[length:var(--app-font-size-auxiliary)] font-medium text-[var(--app-subtle-foreground)]">配置项 · {searchResults.length}</h2>
                {searchResults.map((item) => {
                  const section = SETTINGS_NAVIGATION.find((section) => section.id === item.section)!;
                  const Icon = section.icon;
                  return (
                    <button key={`${item.section}:${item.label}`} type="button"
                      aria-label={`${section.label}：${item.label}`}
                      className="mb-1 flex w-full items-start gap-2 rounded-[var(--app-radius)] px-2 py-2 text-left text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] data-[active=true]:bg-[var(--app-selection)]"
                      data-active={searchTarget?.section === item.section && searchTarget.label === item.label}
                      onClick={() => { setSearchTarget({ ...item }); setActiveSection(item.section); }}>
                      <Icon aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
                      <span className="min-w-0"><span className="block break-words">{item.label}</span><span className="block text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{section.label}</span></span>
                    </button>
                  );
                })}
              </section>
            ) : null}
            {filteredNavigation.length === 0 && searchResults.length === 0 ? (
              <p className="m-0 px-2 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]" role="status">无匹配的设置</p>
            ) : null}
          </div>
        </nav>

        <ResizableDivider
          ariaLabel="调整设置菜单宽度"
          className="settings-navigation-divider"
          direction="from-start"
          collapsible={false}
          defaultSize={240}
          keyboardStep={10}
          min={SETTINGS_NAVIGATION_WIDTH_RANGE.min}
          max={maximumWidth}
          size={displayedWidth}
          onResize={setNavigationWidth}
          onCollapsedChange={() => {}}
        />

        <div key={activeSection} ref={contentRef} className="settings-content [&_[data-settings-search-highlight]]:rounded-[var(--app-radius)] [&_[data-settings-search-highlight]]:outline-2 [&_[data-settings-search-highlight]]:-outline-offset-2 [&_[data-settings-search-highlight]]:outline-[var(--app-focus-ring)]" data-section={activeSection}>
          {searchTarget !== null && searchTarget.section === activeSection && locatedTarget !== searchTarget && ["models", "agents", "mcp", "skills"].includes(activeSection) ? (
            <p role="status" className="m-0 mb-3 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">选择或创建包含“{searchTarget.label}”的配置后可定位此项{activeSection === "mcp" ? "，请使用表单视图" : ""}。</p>
          ) : null}
          {activeSection === "general" ? <GeneralSettings agentClient={agentClient} /> : null}
          {activeSection === "models" ? (
            <ModelsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "reasoning" ? <ModelReasoningCatalogSettings agentClient={agentClient} /> : null}
          {activeSection === "agents" ? <AgentTeamSettings agentClient={agentClient} searchTarget={searchTarget} /> : null}
          {activeSection === "mcp" ? (
            <McpSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "skills" ? (
            <SkillsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "permissions" ? <PermissionsSettings /> : null}
          {activeSection === "computer-use" ? <ComputerUseSettings agentClient={agentClient} /> : null}
          {activeSection === "browser" ? (
            <BrowserSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "terminal" ? (
            <TerminalSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "archived" ? (
            <ArchivedConversationsSettings agentClient={agentClient} />
          ) : null}
          {activeSection === "appearance" ? <AppearanceSettings /> : null}
        </div>
      </div>
    </section>
  );
}
