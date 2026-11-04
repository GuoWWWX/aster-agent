import { useEffect, useState, type ReactElement } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { AgentClient } from "../../../runtime/index.js";
import { useAppUpdate } from "../../updates/use-app-update.js";
import { SettingsSectionHeader } from "../components/settings-section-header.js";

const REPOSITORY_URL = "https://github.com/GuoWWWX/aster-agent";

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function AboutSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const { state, error, run } = useAppUpdate(agentClient);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void agentClient.getRuntimeInfo().then((info) => { if (!disposed) setVersion(info.appVersion); }, () => undefined);
    return () => { disposed = true; };
  }, [agentClient]);
  const status = state?.status;
  const progress = state?.progress;
  const percent = progress === null || progress === undefined ? 0 : Math.min(100, progress.transferred / progress.total * 100);
  const description = status === "checking" ? "正在检查更新…" : status === "up-to-date" ? "当前已是最新版本。"
    : status === "available" ? `发现新版本 ${state?.availableVersion}。`
    : status === "downloading" ? "正在下载更新。" : status === "paused" ? "下载已暂停，可以继续。"
    : status === "downloaded" ? `版本 ${state?.availableVersion} 已准备好安装。`
    : status === "unavailable" ? state?.message : status === "error" ? state?.message : state === null ? "更新状态暂不可用。" : "自动检查更新已启用。";

  return (
    <SettingsSectionHeader bodyClassName="settings-section__body--general" eyebrow="版本、更新与项目地址" title="关于">
      <section className="settings-general-category" aria-labelledby="about-app-heading">
        <h3 id="about-app-heading">Aster</h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div><h4>当前版本</h4><p>{state?.currentVersion ?? version ?? "读取中…"}</p></div>
          </article>
          <article className="settings-general-row">
            <div><h4>GitHub 项目</h4><p>查看项目源码、发布版本与更新说明</p></div>
            <a className="settings-secondary-button inline-flex items-center gap-1" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              打开 GitHub <ExternalLink aria-hidden="true" size={14} />
            </a>
          </article>
        </div>
      </section>
      <section className="settings-general-category" aria-labelledby="about-update-heading">
        <h3 id="about-update-heading">软件更新</h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div className="min-w-0 flex-1">
              <h4>{state?.availableVersion === null || state?.availableVersion === undefined ? "更新状态" : `新版本 ${state.availableVersion}`}</h4>
              <p role="status">{error ?? description}</p>
              {progress !== null && progress !== undefined && (status === "downloading" || status === "paused") ? (
                <div className="mt-2 max-w-md">
                  <progress aria-label="更新下载进度" className="h-1.5 w-full accent-[var(--app-accent)]" max={100} value={percent} />
                  <p>{progress.mode === "differential" ? "差量更新" : "完整更新"} · {percent.toFixed(1)}% · {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
                    {status === "downloading" && progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ""}</p>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button className="settings-secondary-button inline-flex items-center gap-1" disabled={state === null || status === "checking" || status === "unavailable"} type="button" onClick={() => { void run("check"); }}>
                <RefreshCw aria-hidden="true" size={14} />检查更新
              </button>
              {state?.availableVersion !== null && state?.availableVersion !== undefined && ["available", "paused", "error"].includes(status ?? "") ? (
                <button className="settings-secondary-button" type="button" onClick={() => { void run("download"); }}>
                  {status === "available" ? "下载更新" : "继续下载"}
                </button>
              ) : null}
              {status === "downloading" ? <button className="settings-secondary-button" type="button" onClick={() => { void run("pause"); }}>暂停下载</button> : null}
              {status === "downloaded" ? <button className="settings-secondary-button" type="button" onClick={() => { void run("install"); }}>重启并安装</button> : null}
            </div>
          </article>
        </div>
      </section>
    </SettingsSectionHeader>
  );
}
