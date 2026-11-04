import { LoadingState, Spinner } from "../../../components/ui/loading.js";
import { Eye, EyeOff, FolderOpen, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  DEFAULT_BROWSER_CONFIGURATION,
  type BrowserConfiguration,
  type BrowserSavedPassword,
  browserConfigurationSchema,
} from "@agent/protocol";
import { IconButton } from "../../../components/ui/icon-button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { type AgentClient } from "../../../runtime/index.js";
import { useQueuedAutoSave } from "../use-queued-auto-save.js";
import { autoSaveStateLabel, errorMessage } from "../configuration-state.js";

const BROWSER_ZOOM_OPTIONS = [
  25,
  33,
  50,
  67,
  75,
  80,
  90,
  100,
  110,
  125,
  150,
  175,
  200,
  250,
  300,
  400,
  500,
] as const;

export function BrowserSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [draft, setDraft] = useState<BrowserConfiguration>(
    structuredClone(DEFAULT_BROWSER_CONFIGURATION),
  );
  const [operationError, setOperationError] = useState<string | null>(null);
  const [clearState, setClearState] = useState<"idle" | "clearing" | "cleared">("idle");
  const [saveRevision, setSaveRevision] = useState(0);
  const draftRef = useRef(draft);
  const latestSaveRevisionRef = useRef(0);
  const [defaultDownloadDirectory, setDefaultDownloadDirectory] = useState<string | null>(null);
  const [savedPasswords, setSavedPasswords] = useState<BrowserSavedPassword[] | null>(null);
  const [passwordListError, setPasswordListError] = useState<string | null>(null);
  const [visiblePassword, setVisiblePassword] = useState<{ origin: string; password: string } | null>(null);
  const [revealingOrigin, setRevealingOrigin] = useState<string | null>(null);
  const passwordRequestRevisionRef = useRef(0);

  const loadSavedPasswords = async (): Promise<void> => {
    const revision = ++passwordRequestRevisionRef.current;
    try {
      const passwords = await agentClient.getBrowserSavedPasswords();
      if (revision === passwordRequestRevisionRef.current) {
        setSavedPasswords(passwords);
        setVisiblePassword(null);
        setRevealingOrigin(null);
        setPasswordListError(null);
      }
    } catch (error) {
      if (revision === passwordRequestRevisionRef.current) setPasswordListError(errorMessage(error));
    }
  };

  useEffect(() => {
    const revision = ++passwordRequestRevisionRef.current;
    void agentClient.getBrowserSavedPasswords().then(
      (passwords) => {
        if (revision !== passwordRequestRevisionRef.current) return;
        setSavedPasswords(passwords);
        setVisiblePassword(null);
        setRevealingOrigin(null);
        setPasswordListError(null);
      },
      (error: unknown) => {
        if (revision !== passwordRequestRevisionRef.current) return;
        setVisiblePassword(null);
        setRevealingOrigin(null);
        setPasswordListError(errorMessage(error));
      },
    );
    return () => { passwordRequestRevisionRef.current += 1; };
  }, [agentClient]);

  const showPassword = async (origin: string): Promise<void> => {
    if (visiblePassword?.origin === origin) {
      setVisiblePassword(null);
      return;
    }
    const revision = passwordRequestRevisionRef.current;
    setVisiblePassword(null);
    setRevealingOrigin(origin);
    setPasswordListError(null);
    try {
      const password = await agentClient.revealBrowserPassword({ origin });
      if (revision !== passwordRequestRevisionRef.current) return;
      if (password === null) setPasswordListError("无法读取该密码，请刷新列表。");
      else setVisiblePassword({ origin, password });
    } catch (error) {
      if (revision === passwordRequestRevisionRef.current) setPasswordListError(errorMessage(error));
    } finally {
      if (revision === passwordRequestRevisionRef.current) setRevealingOrigin(null);
    }
  };

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let disposed = false;
    void agentClient.getBrowserConfiguration().then(
      (configuration) => {
        if (!disposed) setDraft(configuration);
      },
      () => {
        if (!disposed) setOperationError("无法读取浏览器配置");
      },
    );
    void agentClient.getBrowserDefaultDownloadDirectory().then(
      (directory) => { if (!disposed) setDefaultDownloadDirectory(directory); },
      (error: unknown) => { if (!disposed) setOperationError(errorMessage(error)); },
    );
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  const autoSave = useQueuedAutoSave({
    revision: saveRevision,
    save: (next: BrowserConfiguration) => agentClient.saveBrowserConfiguration(next),
    validate: (next: BrowserConfiguration) => {
      const parsed = browserConfigurationSchema.safeParse(next);
      return parsed.success ? parsed.data : null;
    },
    value: draft,
    onError: (reason) => setOperationError(errorMessage(reason)),
    onSaved: (configuration, revision) => {
      if (revision !== latestSaveRevisionRef.current) return;
      draftRef.current = configuration;
      setDraft(configuration);
    },
  });

  const updateConfiguration = (update: Partial<BrowserConfiguration>): void => {
    const next = { ...draftRef.current, ...update };
    draftRef.current = next;
    setDraft(next);
    setOperationError(null);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
  };

  const clearBrowserData = async (): Promise<void> => {
    setClearState("clearing");
    setOperationError(null);
    try {
      await agentClient.clearBrowserData();
      passwordRequestRevisionRef.current += 1;
      setSavedPasswords([]);
      setVisiblePassword(null);
      setRevealingOrigin(null);
      setPasswordListError(null);
      setClearState("cleared");
    } catch (error) {
      setClearState("idle");
      setOperationError(errorMessage(error));
    }
  };

  return (
    <SettingsSectionHeader
      bodyClassName="settings-section__body--general"
      eyebrow="内置浏览器"
      title="浏览器"
    >
      <section className="settings-general-category" aria-labelledby="browser-startup-heading">
        <h3 id="browser-startup-heading">
          <Search aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          启动与搜索
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>默认搜索引擎</h4>
              <p>地址栏输入的内容不是网址时，使用此搜索引擎。</p>
            </div>
            <Select
              value={draft.searchEngine}
              onValueChange={(value) => updateConfiguration({
                searchEngine: value as BrowserConfiguration["searchEngine"],
              })}
            >
              <SelectTrigger aria-label="默认搜索引擎" className="settings-general-select w-[160px] max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="bing">Bing</SelectItem>
                <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
              </SelectContent>
            </Select>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>新标签默认缩放</h4>
              <p>当前的 100% 对应原始网页的 80%，只影响之后新建的标签。</p>
            </div>
            <Select
              value={String(draft.defaultZoomPercent)}
              onValueChange={(value) => updateConfiguration({ defaultZoomPercent: Number(value) })}
            >
              <SelectTrigger aria-label="新浏览器标签默认缩放" className="settings-general-select w-[160px] max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {BROWSER_ZOOM_OPTIONS.map((percent) => (
                  <SelectItem key={percent} value={String(percent)}>{percent}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </article>
        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="browser-download-heading">
        <h3 id="browser-download-heading">
          <FolderOpen aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          下载
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div className="min-w-0">
              <h4 id="browser-download-directory">下载目录</h4>
              <p className="break-all" title={draft.downloadDirectory || defaultDownloadDirectory || undefined}>
                {draft.downloadDirectory || defaultDownloadDirectory || "正在读取下载目录…"}
                {draft.downloadDirectory === "" && defaultDownloadDirectory !== null ? "（默认）" : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-[5px]">
              <button className="settings-secondary-button" type="button" onClick={() => {
                void agentClient.chooseBrowserDownloadDirectory().then((directory) => {
                  if (directory !== null) updateConfiguration({ downloadDirectory: directory });
                }).catch((error: unknown) => setOperationError(errorMessage(error)));
              }}><FolderOpen aria-hidden="true" size={14} />选择目录</button>
              <button className="settings-secondary-button" type="button" disabled={draft.downloadDirectory === ""} onClick={() => updateConfiguration({ downloadDirectory: "" })}>恢复默认</button>
            </div>
          </article>
          <article className="settings-general-row">
            <div>
              <h4>下载前询问保存位置</h4>
              <p>关闭时自动保存到下载目录；开启时每次选择保存位置。</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="下载前询问保存位置"
                checked={draft.askForDownloadLocation}
                type="checkbox"
                onChange={(event) => updateConfiguration({
                  askForDownloadLocation: event.target.checked,
                })}
              />
              <span aria-hidden="true" />
            </label>
          </article>
        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="browser-password-heading">
        <h3 id="browser-password-heading">
          <EyeOff aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          密码和自动填充
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>密码保存</h4>
              <p>在 HTTPS 网站登录时询问保存密码，使用系统加密存储，下次访问同一网站自动填充。关闭后停止保存与填充。</p>
            </div>
            <label className="settings-switch">
              <input aria-label="保存并自动填充密码" checked={draft.savePasswords} type="checkbox" onChange={(event) => updateConfiguration({ savePasswords: event.target.checked })} />
              <span aria-hidden="true" />
            </label>
          </article>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--app-border)] px-4 py-3">
            <h4 id="browser-saved-passwords" className="m-0 text-[length:var(--app-font-size-body)] font-semibold">已保存的密码{savedPasswords === null ? "" : `（${savedPasswords.length}）`}</h4>
            <IconButton label="刷新已保存密码" disabled={revealingOrigin !== null} onClick={() => {
              setSavedPasswords(null);
              setVisiblePassword(null);
              setPasswordListError(null);
              void loadSavedPasswords();
            }}>
              <RefreshCw aria-hidden="true" size={14} />
            </IconButton>
          </div>
          {passwordListError === null ? null : <p className="px-4 pb-3 text-[length:var(--app-font-size-control)] text-[var(--app-destructive)]" role="alert">{passwordListError}</p>}
          {savedPasswords === null ? (
            passwordListError === null ? <LoadingState label="正在读取已保存密码…" compact /> : null
          ) : savedPasswords.length === 0 ? (
            <p className="px-4 pb-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">还没有已保存的密码。</p>
          ) : savedPasswords.map((entry) => {
            const password = visiblePassword?.origin === entry.origin ? visiblePassword.password : null;
            return (
              <article className="settings-general-row" key={entry.origin}>
                <div className="min-w-0">
                  <h4 className="break-all">{entry.origin}</h4>
                  <p className="break-all">{entry.username || "未记录账号"}</p>
                </div>
                <div className="flex min-w-0 items-center gap-[5px]">
                  <input aria-label={`${entry.origin} 的密码`} readOnly type={password === null ? "password" : "text"} value={password ?? "********"}
                    className="h-8 w-44 min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 text-[length:var(--app-font-size-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]" />
                  <IconButton label={`${password === null ? "查看" : "隐藏"} ${entry.origin} 的密码`} tooltip={password === null ? "查看密码" : "隐藏密码"}
                    disabled={revealingOrigin !== null} onClick={() => void showPassword(entry.origin)}>
                    {revealingOrigin === entry.origin ? <Spinner aria-hidden="true" size={14} /> : password === null ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="browser-privacy-heading">
        <h3 id="browser-privacy-heading">
          <ShieldCheck aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          隐私
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>清除浏览数据</h4>
              <p>清除内置浏览器的 Cookie、缓存、站点数据、已保存密码和当前历史记录。</p>
            </div>
            <button
              className="settings-secondary-button"
              disabled={clearState === "clearing"}
              type="button"
              onClick={() => void clearBrowserData()}
            >
              {clearState === "clearing" ? <Spinner size={14} /> : <Trash2 aria-hidden="true" size={14} />}
              {clearState === "clearing" ? "正在清除" : "清除浏览数据"}
            </button>
          </article>
        </div>
      </section>

      {clearState === "cleared" ? (
        <p className="settings-terminal-status" role="status">浏览数据已清除。</p>
      ) : null}
      {operationError !== null ? (
        <p className="settings-terminal-status" role="alert">{operationError}</p>
      ) : autoSave.state === "idle" ? null : (
        <p className="settings-terminal-status" role="status">
          {autoSaveStateLabel(autoSave.state)}
        </p>
      )}
    </SettingsSectionHeader>
  );
}
