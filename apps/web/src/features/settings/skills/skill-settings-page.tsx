import { LoadingState, Spinner } from "../../../components/ui/loading.js";
import { Eye, FolderOpen, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { type SkillConfiguration, type SkillDocument, parseSkillMarkdown } from "@agent/protocol";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog.js";
import { AgentMarkdown } from "../../../components/markdown/agent-markdown.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { type AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import {
  SettingsConfigurationCard,
  SettingsConfigurationGroup,
} from "../components/settings-configuration-card.js";
import { useIntegrationConfiguration } from "../integrations/use-integration-configuration.js";
import {
  ConfigurationStatus,
  ConfigurationList,
  ConfigurationEmpty,
  ConfigurationEditorHeader,
  ConfigurationField,
  ScopeField,
} from "../integrations/configuration-editor.js";
import { autoSaveStateLabel, errorMessage } from "../configuration-state.js";

export function SkillsSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const state = useIntegrationConfiguration(agentClient);
  const { reload, setError } = state;
  const [defaultDirectoryPath, setDefaultDirectoryPath] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [newSkillDirectoryPath, setNewSkillDirectoryPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skillDocuments, setSkillDocuments] = useState<SkillDocument[]>([]);
  const [skillToDelete, setSkillToDelete] = useState<SkillConfiguration | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [skillDeleteError, setSkillDeleteError] = useState<string | null>(null);
  const configurationWorkspaceRevision = useWorkbenchUiStore(
    (current) => current.configurationWorkspaceRevision,
  );
  const openConfigurationWorkspace = useWorkbenchUiStore(
    (current) => current.openConfigurationWorkspace,
  );
  const configuration = state.configuration;
  const skills = configuration?.skills ?? [];
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null;
  const selectedDocument = skillDocuments.find((document) => (
    document.entryPath.toLocaleLowerCase("en-US") === selected?.entryPath.toLocaleLowerCase("en-US")
  ));
  const skillPreview = useMemo(() => selectedDocument === undefined
    ? null : parseSkillMarkdown(selectedDocument.content), [selectedDocument]);
  const creationDirectoryPath = newSkillDirectoryPath ?? defaultDirectoryPath;

  const discoverSkills = useCallback(async (): Promise<void> => {
    setIsDiscovering(true);
    setError(null);
    try {
      const result = await agentClient.discoverSkillDocuments();
      setSkillDocuments(result.documents);
      setDefaultDirectoryPath(result.defaultDirectoryPath);
      setNewSkillDirectoryPath((current) => current ?? result.defaultDirectoryPath);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setIsDiscovering(false);
    }
  }, [agentClient, reload, setError]);

  // Initial discovery on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial data fetch
    void discoverSkills();
  }, [discoverSkills]);

  // Re-discover when configuration workspace changes
  useEffect(() => {
    if (configurationWorkspaceRevision === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- React to external state change
    void discoverSkills();
  }, [configurationWorkspaceRevision, discoverSkills]);

  function updateSkill(update: Partial<SkillConfiguration>): void {
    if (configuration === null || selected === null) return;
    state.update({
      ...configuration,
      skills: skills.map((skill) => skill.id === selected.id ? { ...skill, ...update } : skill),
    });
  }

  async function createSkill(): Promise<void> {
    if (creationDirectoryPath === null) return;
    state.setError(null);
    try {
      const document = await agentClient.createSkillDocument({
        directoryPath: creationDirectoryPath,
      });
      setSkillDocuments((current) => [...current, document]);
      const next = await state.reload();
      const created = next?.skills.find((skill) => (
        skill.entryPath.toLocaleLowerCase("en-US") === document.entryPath.toLocaleLowerCase("en-US")
      ));
      if (created === undefined) return;
      setSelectedId(created.id);
      openConfigurationWorkspace({
        configurationId: created.id,
        kind: "skill",
        title: created.name,
      });
    } catch (reason) {
      state.setError(errorMessage(reason));
    }
  }

  async function chooseSkillDirectory(): Promise<void> {
    state.setError(null);
    try {
      const result = await agentClient.chooseSkillDirectory();
      if (result === null) return;
      setSkillDocuments(result.documents);
      setDefaultDirectoryPath(result.defaultDirectoryPath);
      setNewSkillDirectoryPath(result.defaultDirectoryPath);
      await state.reload();
    } catch (reason) {
      state.setError(errorMessage(reason));
    }
  }

  function removeDirectory(directoryPath: string): void {
    if (configuration === null) return;
    state.update({
      ...configuration,
      skillDirectories: configuration.skillDirectories.filter((path) => path !== directoryPath),
    });
    if (newSkillDirectoryPath === directoryPath) {
      setNewSkillDirectoryPath(defaultDirectoryPath);
    }
  }

  async function deleteSkill(): Promise<void> {
    if (skillToDelete === null) return;
    setIsDeletingSkill(true);
    setSkillDeleteError(null);
    try {
      if (!await state.flush()) throw new Error("请先完成当前配置的保存。");
      await agentClient.deleteSkillDocument({ entryPath: skillToDelete.entryPath });
      const next = await state.reload();
      if (next !== null) {
        setSkillDocuments((current) => current.filter((document) => next.skills.some((skill) => skill.entryPath === document.entryPath)));
        if (!next.skills.some((skill) => skill.id === selected?.id)) setSelectedId(next.skills[0]?.id ?? null);
        const target = useWorkbenchUiStore.getState().configurationWorkspaceTarget;
        if (target?.kind === "skill" && !next.skills.some((skill) => skill.id === target.configurationId)) {
          useWorkbenchUiStore.getState().closeConfigurationWorkspace(target);
        }
      }
      setSkillToDelete(null);
    } catch (reason) {
      setSkillDeleteError(errorMessage(reason));
    } finally {
      setIsDeletingSkill(false);
    }
  }

  async function openFileWorkspace(): Promise<void> {
    if (selected === null) return;
    if (!await state.flush()) return;
    openConfigurationWorkspace({
      configurationId: selected.id,
      kind: "skill",
      title: selected.name,
    });
  }

  return (
    <SettingsSectionHeader
      action={(
        <div className="settings-section-actions">
          <Select
            disabled={creationDirectoryPath === null}
            value={creationDirectoryPath ?? ""}
            onValueChange={setNewSkillDirectoryPath}
          >
            <SelectTrigger
              aria-label="新建 Skill 的目录"
              className="settings-select-trigger settings-skill-source-select"
              title={creationDirectoryPath ?? "正在读取目录"}
            >
              <SelectValue placeholder="正在读取目录">
                <span className="truncate">
                  {creationDirectoryPath === defaultDirectoryPath ? `默认目录 · ${creationDirectoryPath ?? ""}` : creationDirectoryPath}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {defaultDirectoryPath === null ? null : (
                <SelectItem value={defaultDirectoryPath}>默认目录 · {defaultDirectoryPath}</SelectItem>
              )}
              {(configuration?.skillDirectories ?? []).map((directoryPath) => (
                <SelectItem key={directoryPath} value={directoryPath}>{directoryPath}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconButton
            disabled={isDiscovering}
            label="重新扫描 Skill 目录"
            onClick={() => void discoverSkills()}
          >
            <RefreshCw aria-hidden="true" className={isDiscovering ? "settings-spin" : undefined} size={16} />
          </IconButton>
          {creationDirectoryPath !== null && configuration?.skillDirectories.includes(creationDirectoryPath) ? (
            <IconButton
              disabled={isDiscovering}
              label="停止扫描所选目录"
              tooltip={`停止扫描 ${creationDirectoryPath}`}
              variant="destructive"
              onClick={() => removeDirectory(creationDirectoryPath)}
            >
              <Trash2 aria-hidden="true" size={16} />
            </IconButton>
          ) : null}
          <IconButton
            disabled={isDiscovering}
            label="添加外部目录"
            onClick={() => void chooseSkillDirectory()}
          >
            <FolderOpen aria-hidden="true" size={16} />
          </IconButton>
        </div>
      )}
      bodyClassName="settings-section__body--flush"
      eyebrow="指令 · 流程 · 模板"
      title="Skill"
    >
      {configuration === null ? (
        <ConfigurationStatus error={state.error} />
      ) : (
        <div className="settings-integration-manager settings-integration-manager--skill">
          <ConfigurationList
            actionLabel="新建 Skill"
            addDisabled={creationDirectoryPath === null}
            emptyLabel="暂无 Skill"
            headingLabel="Skill 列表"
            icon={Sparkles}
            items={skills.map((skill) => ({
              deleteDisabledReason: skill.origin === "system" ? "内置 Skill 可停用，不能删除" : undefined,
              enabled: skill.enabled,
              id: skill.id,
              name: skill.name,
              summary: `${skill.origin === "system" ? "系统 · 只读" : "个人"} · ${skill.entryPath}`,
            }))}
            selectedId={selected?.id ?? null}
            onAdd={() => void createSkill()}
            onDelete={(id) => {
              setSkillDeleteError(null);
              setSkillToDelete(skills.find((skill) => skill.id === id) ?? null);
            }}
            onSelect={setSelectedId}
          />
          {selected === null ? (
            <ConfigurationEmpty icon={Sparkles} label="新建 Skill" onAdd={() => void createSkill()} />
          ) : (
            <section className="settings-integration-editor settings-skill-metadata">
              <ConfigurationEditorHeader
                enabled={selected.enabled}
                fileActionLabel={selected.origin === "system" ? "查看文档" : "编辑文档"}
                icon={Sparkles}
                name={`${selected.name} · ${selected.origin === "system" ? "系统技能 · 只读" : "个人技能"}`}
                onOpenFile={() => void openFileWorkspace()}
                onToggle={(enabled) => updateSkill({ enabled })}
              />
              <SettingsConfigurationCard aria-label="Skill 基本配置">
                <div className="settings-field-grid settings-skill-fields">
                  <ConfigurationField className="settings-field--wide" label="SKILL.md 路径">
                    <input readOnly title={selected.entryPath} value={selected.entryPath} />
                  </ConfigurationField>
                  {selected.origin === "system" ? (
                    <ConfigurationField label="作用域"><input readOnly value={{ user: "用户", team: "团队", project: "项目" }[selected.scope]} /></ConfigurationField>
                  ) : <ScopeField scope={selected.scope} onChange={(scope) => updateSkill({ scope })} />}
                  <ConfigurationField className="settings-field--wide" label="MCP 依赖">
                    <input
                      readOnly={selected.origin === "system"}
                      value={selected.mcpDependencies.join(", ")}
                      onChange={(event) => updateSkill({
                        mcpDependencies: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                      })}
                    />
                  </ConfigurationField>
                </div>
              </SettingsConfigurationCard>
              <SettingsConfigurationGroup cardAriaLabel="Skill 文档预览" icon={Eye} title="文档预览">
                <div className="min-w-0">
                  {skillPreview === null ? (
                    isDiscovering ? <LoadingState label="正在读取文档…" compact /> : <p className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">未找到 Skill 文档。</p>
                  ) : (
                    <>
                      <p className="mb-4 text-[length:var(--app-font-size-body)] text-[var(--app-muted-foreground)]">{skillPreview.metadata.description}</p>
                      <AgentMarkdown content={skillPreview.body} />
                    </>
                  )}
                </div>
              </SettingsConfigurationGroup>
              <footer className="settings-integration-editor__footer">
                <div>
                  {state.error === null
                    ? <span>{autoSaveStateLabel(state.autoSaveState)}</span>
                    : <p role="alert">{state.error}</p>}
                </div>
              </footer>
            </section>
          )}
        </div>
      )}
      <Dialog open={skillToDelete !== null} onOpenChange={(open) => {
        if (!open && !isDeletingSkill) setSkillToDelete(null);
      }}>
        <DialogContent className="gap-4 p-5" showCloseButton={!isDeletingSkill}>
          <DialogTitle>删除 Skill「{skillToDelete?.name}」？</DialogTitle>
          <DialogDescription>将删除下列目录及其中的所有文件，包括指令、脚本和资源。此操作无法撤销。</DialogDescription>
          <p className="m-0 break-all rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] p-3 text-[length:var(--app-font-size-control)]">
            {skillToDelete?.entryPath.replace(/[/\\][^/\\]+$/, "")}
          </p>
          {skillDeleteError === null ? null : <p className="m-0 text-[var(--app-destructive)]" role="alert">{skillDeleteError}</p>}
          <div className="flex justify-end gap-2">
            <button className="settings-secondary-button" disabled={isDeletingSkill} type="button" onClick={() => setSkillToDelete(null)}>取消</button>
            <button className="settings-danger-button" disabled={isDeletingSkill} type="button" onClick={() => void deleteSkill()}>{isDeletingSkill ? <><Spinner size={14} />正在删除…</> : "删除目录和文件"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSectionHeader>
  );
}
