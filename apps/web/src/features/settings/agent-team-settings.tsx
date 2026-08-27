import {
  Boxes,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  ImagePlus,
  Layers3,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useState, type ChangeEvent, type ReactElement } from "react";

import { IconButton } from "../../components/ui/icon-button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  AVAILABLE_MCP_SERVERS,
  AVAILABLE_SKILLS,
  useAgentDirectoryStore,
  type AgentCapabilityScope,
  type AgentPermissionRule,
  type AgentPermissionTool,
  type AgentModelStrategy,
  type AgentProfile,
  type AgentTeam,
} from "../../stores/agent-directory-store.js";
import { AgentAvatar, AGENT_AVATAR_ICON_OPTIONS } from "../team/agent-avatar.js";
import "./agent-team-settings.css";

type ManagementView = "agents" | "teams";

const DIRECTORY_PAGE_SIZE = 8;

const MODEL_STRATEGY_LABEL: Record<AgentModelStrategy, string> = {
  auto: "自动选择",
  fixed: "固定模型",
  inherit: "继承对话",
};

export function AgentTeamSettings(): ReactElement {
  const [activeView, setActiveView] = useState<ManagementView>("teams");
  const agents = useAgentDirectoryStore((state) => state.agents);
  const teams = useAgentDirectoryStore((state) => state.teams);
  const addAgent = useAgentDirectoryStore((state) => state.addAgent);
  const addTeam = useAgentDirectoryStore((state) => state.addTeam);
  const [selectedAgentId, setSelectedAgentId] = useState(
    agents.find((agent) => agent.isDefault)?.id ?? agents[0]?.id ?? "",
  );
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const activeAgents = agents.filter((agent) => agent.enabled).length;
  const customCapabilityAgents = agents.filter(
    (agent) => agent.capabilityScope === "custom",
  ).length;

  return (
    <section className="settings-section agent-team-settings" aria-labelledby="settings-agent-team-heading">
      <header className="settings-section__header">
        <div className="settings-section__title-row">
          <h2 id="settings-agent-team-heading">Agent 与团队</h2>
          <p className="settings-section__description">执行角色与协作编排</p>
        </div>
        <span className="workspace-mode-badge">跨项目复用</span>
      </header>

      <div className="agent-team-settings__body">
        <div className="team-management-toolbar">
          <div className="team-management-tabs" role="tablist" aria-label="管理对象">
            <button
              aria-selected={activeView === "teams"}
              role="tab"
              type="button"
              onClick={() => setActiveView("teams")}
            >
              <UsersRound aria-hidden="true" size={14} />
              团队
              <span>{teams.length}</span>
            </button>
            <button
              aria-selected={activeView === "agents"}
              role="tab"
              type="button"
              onClick={() => setActiveView("agents")}
            >
              <BrainCircuit aria-hidden="true" size={14} />
              Agent
              <span>{agents.length}</span>
            </button>
          </div>
          {activeView === "agents" ? (
            <IconButton
              label="新建 Agent"
              size="compact"
              onClick={() => setSelectedAgentId(addAgent())}
            >
              <CirclePlus aria-hidden="true" size={18} />
            </IconButton>
          ) : null}
        </div>

        <div className="team-metrics" aria-label="Agent 与团队概况">
          <TeamMetric icon={UsersRound} label="可用团队" value={String(teams.length)} />
          <TeamMetric icon={BrainCircuit} label="启用 Agent" value={`${activeAgents} / ${agents.length}`} />
          <TeamMetric icon={Sparkles} label="继承全部能力" value={String(agents.length - customCapabilityAgents)} />
          <TeamMetric icon={ShieldCheck} label="自定义能力范围" value={String(customCapabilityAgents)} />
        </div>

        {activeView === "teams" ? (
          <TeamManagementView
            agents={agents}
            onCreateTeam={() => {
              const id = addTeam();
              setSelectedTeamId(id);
            }}
            selectedAgentId={selectedAgentId}
            selectedTeamId={selectedTeamId}
            teams={teams}
            onOpenAgent={(agentId) => {
              setSelectedAgentId(agentId);
              setActiveView("agents");
            }}
            onSelectMember={setSelectedAgentId}
            onSelectTeam={(teamId) => {
              const team = teams.find((candidate) => candidate.id === teamId);
              setSelectedTeamId(teamId);
              setSelectedAgentId(team?.leadAgentId ?? "");
            }}
          />
        ) : (
          <AgentManagementView
            agents={agents}
            selectedAgentId={selectedAgentId}
            teams={teams}
            onSelectAgent={setSelectedAgentId}
          />
        )}
      </div>
    </section>
  );
}

function TeamManagementView({
  agents,
  onCreateTeam,
  onOpenAgent,
  onSelectMember,
  onSelectTeam,
  selectedAgentId,
  selectedTeamId,
  teams,
}: {
  agents: AgentProfile[];
  onCreateTeam: () => void;
  onOpenAgent: (agentId: string) => void;
  onSelectMember: (agentId: string) => void;
  onSelectTeam: (teamId: string) => void;
  selectedAgentId: string;
  selectedTeamId: string;
  teams: AgentTeam[];
}): ReactElement {
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const [teamPage, setTeamPage] = useState(0);
  const teamPageCount = Math.max(1, Math.ceil(teams.length / DIRECTORY_PAGE_SIZE));
  const currentTeamPage = Math.min(teamPage, teamPageCount - 1);
  const pagedTeams = teams.slice(
    currentTeamPage * DIRECTORY_PAGE_SIZE,
    (currentTeamPage + 1) * DIRECTORY_PAGE_SIZE,
  );

  if (selectedTeam === undefined) {
    return <ManagementEmpty icon={UsersRound} label="还没有团队" />;
  }

  const members = selectedTeam.memberIds
    .map((memberId) => agents.find((agent) => agent.id === memberId))
    .filter((agent): agent is AgentProfile => agent !== undefined);
  const selectedMember = members.find((agent) => agent.id === selectedAgentId)
    ?? members.find((agent) => agent.id === selectedTeam.leadAgentId)
    ?? members[0];

  return (
    <div className="team-management-layout">
      <section className="team-directory-pane" aria-label="团队列表">
        <PaneHeading
          label="团队目录"
          action={(
            <IconButton
              label="创建团队"
              size="compact"
              onClick={() => {
                onCreateTeam();
                setTeamPage(Math.floor(teams.length / DIRECTORY_PAGE_SIZE));
              }}
            >
              <CirclePlus aria-hidden="true" size={18} />
            </IconButton>
          )}
        />
        <div className="team-directory-list">
          {pagedTeams.map((team) => (
            <button
              key={team.id}
              aria-pressed={team.id === selectedTeam.id}
              className="team-directory-row"
              data-selected={team.id === selectedTeam.id}
              type="button"
              onClick={() => onSelectTeam(team.id)}
            >
              <span className="team-directory-row__icon">
                <UsersRound aria-hidden="true" size={15} />
              </span>
              <span>
                <strong>{team.name}</strong>
                <small>{team.memberIds.length} 名成员 · 全部项目</small>
              </span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          ))}
        </div>
        <footer className="team-directory-footer">
          <span>共 {teams.length} 个团队</span>
          <div className="team-directory-pagination-controls" aria-label="团队分页">
            <button
              aria-label="上一页"
              disabled={currentTeamPage === 0}
              title="上一页"
              type="button"
              onClick={() => setTeamPage(Math.max(0, currentTeamPage - 1))}
            >
              <ChevronLeft aria-hidden="true" size={14} />
            </button>
            <span aria-label={`第 ${currentTeamPage + 1} 页，共 ${teamPageCount} 页`}>
              {currentTeamPage + 1} / {teamPageCount}
            </span>
            <button
              aria-label="下一页"
              disabled={currentTeamPage >= teamPageCount - 1}
              title="下一页"
              type="button"
              onClick={() => setTeamPage(Math.min(teamPageCount - 1, currentTeamPage + 1))}
            >
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          </div>
        </footer>
      </section>

      <TeamConfigurationPane
        agent={selectedMember}
        agents={agents}
        onOpenAgent={onOpenAgent}
        onSelectMember={onSelectMember}
        team={selectedTeam}
      />
    </div>
  );
}

function AgentManagementView({
  agents,
  onSelectAgent,
  selectedAgentId,
  teams,
}: {
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
  selectedAgentId: string;
  teams: AgentTeam[];
}): ReactElement {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  if (selectedAgent === undefined) {
    return <ManagementEmpty icon={BrainCircuit} label="还没有 Agent" />;
  }

  return (
    <div className="agent-management-layout">
      <section className="agent-directory-pane" aria-label="Agent 列表">
        <PaneHeading label="Agent Profiles" value={agents.length} />
        <div className="agent-directory-list">
          {agents.map((agent) => {
            const teamCount = teams.filter((team) => team.memberIds.includes(agent.id)).length;
            return (
              <button
                key={agent.id}
                aria-pressed={agent.id === selectedAgent.id}
                className="agent-directory-row"
                data-selected={agent.id === selectedAgent.id}
                type="button"
                onClick={() => onSelectAgent(agent.id)}
              >
                <AgentAvatar avatar={agent.avatar} status={agent.status} />
                <span>
                  <span className="agent-directory-row__title">
                    <strong>{agent.name}</strong>
                    {agent.isDefault ? <small>默认</small> : null}
                  </span>
                  <small>{agent.role} · {teamCount} 个团队</small>
                </span>
                <ChevronRight aria-hidden="true" size={14} />
              </button>
            );
          })}
        </div>
        <footer className="team-directory-footer">共 {agents.length} 个 Agent</footer>
      </section>
      <AgentConfigurationPane agent={selectedAgent} teams={teams} />
    </div>
  );
}

function TeamConfigurationPane({
  agent,
  agents,
  onOpenAgent,
  onSelectMember,
  team,
}: {
  agent: AgentProfile | undefined;
  agents: AgentProfile[];
  onOpenAgent: (agentId: string) => void;
  onSelectMember: (agentId: string) => void;
  team: AgentTeam;
}): ReactElement {
  const updateTeam = useAgentDirectoryStore((state) => state.updateTeam);
  const updateTeamMemberConfiguration = useAgentDirectoryStore(
    (state) => state.updateTeamMemberConfiguration,
  );
  const members = team.memberIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((candidate): candidate is AgentProfile => candidate !== undefined);
  const leadCandidates = members;
  const memberConfiguration = agent === undefined
    ? undefined
    : team.memberConfigurations[agent.id];

  return (
    <aside className="team-configuration-pane" aria-label={`${team.name} 配置`}>
      <div className="management-detail-heading">
        <span className="management-detail-heading__icon">
          <Settings2 aria-hidden="true" size={16} />
        </span>
        <div>
          <h2>{team.name}</h2>
        </div>
        <button
          aria-pressed={team.enabled}
          className="management-toggle"
          data-enabled={team.enabled}
          type="button"
          onClick={() => updateTeam(team.id, { enabled: !team.enabled })}
        >
          {team.enabled ? "已启用" : "已停用"}
        </button>
      </div>

      <div className="management-detail-body">
        <div className="management-form">
        <label>
          <span>团队名称</span>
          <input
            value={team.name}
            onChange={(event) => updateTeam(team.id, { name: event.target.value })}
          />
        </label>
        <label>
          <span>团队说明</span>
          <textarea
            rows={3}
            value={team.description}
            onChange={(event) => updateTeam(team.id, { description: event.target.value })}
          />
        </label>
        <label>
          <span className="management-field-label">
            团队指令
            <small>所有成员继承</small>
          </span>
          <textarea
            placeholder="留空时仅注入团队结构、项目和当前任务上下文"
            rows={4}
            value={team.instructions}
            onChange={(event) => updateTeam(team.id, { instructions: event.target.value })}
          />
          <small className="management-field-hint">
            团队名称、成员清单、规模和当前工作项由系统按运行状态自动注入。
          </small>
        </label>
        <div className="management-form__row">
          <label>
            <span>Team Lead</span>
            <Select
              value={team.leadAgentId}
              onValueChange={(leadAgentId) => updateTeam(team.id, { leadAgentId })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {leadCandidates.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>最大 Worker</span>
            <Select
              value={String(team.maxWorkers)}
              onValueChange={(value) => updateTeam(team.id, { maxWorkers: Number(value) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((count) => (
                  <SelectItem key={count} value={String(count)}>{count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        </div>

        <div className="team-member-editor">
        <section className="team-member-management" aria-label={`${team.name} 成员编排`}>
          <PaneHeading label="团队 Agent" value={members.length} />
          <TeamMemberAdd team={team} agents={agents} />
          <div className="team-member-list team-member-list--embedded">
            {members.map((member) => (
              <TeamMemberRow
                key={member.id}
                agent={member}
                isLead={team.leadAgentId === member.id}
                isSelected={agent?.id === member.id}
                team={team}
                onSelect={() => onSelectMember(member.id)}
              />
            ))}
          </div>
        </section>

        {agent === undefined ? (
          <div className="team-member-configuration team-member-configuration--empty">
            <BrainCircuit aria-hidden="true" size={18} />
            <p>从左侧选择一个 Agent 配置团队专属要求。</p>
          </div>
        ) : (
          <section className="team-member-configuration" aria-label={`${agent.name} 团队内配置`}>
            <div className="team-member-configuration__heading">
              <AgentAvatar avatar={agent.avatar} status={agent.status} />
              <div>
                <p>当前 Agent 的团队配置</p>
                <h3>{agent.name}</h3>
              </div>
              <button
                aria-label={`打开 ${agent.name} 的基础配置`}
                title="打开 Agent 基础配置"
                type="button"
                onClick={() => onOpenAgent(agent.id)}
              >
                <Settings2 aria-hidden="true" size={14} />
              </button>
            </div>
            <div className="management-form team-member-configuration__form">
              <p className="team-member-configuration__description">
                左侧选择哪个 Agent，这里的职责和要求就只对它生效。
              </p>
              <label>
                <span className="management-field-label">
                  在本团队中的职责
                  <small>可选</small>
                </span>
                <input
                  placeholder={`留空则沿用：${agent.role}`}
                  value={memberConfiguration?.role ?? ""}
                  onChange={(event) => updateTeamMemberConfiguration(
                    team.id,
                    agent.id,
                    { role: event.target.value },
                  )}
                />
              </label>
              <label>
                <span className="management-field-label">
                  给该成员的额外要求
                  <small>可选</small>
                </span>
                <textarea
                  placeholder="只在当前团队生效；留空则不增加额外要求"
                  rows={4}
                  value={memberConfiguration?.instructions ?? ""}
                  onChange={(event) => updateTeamMemberConfiguration(
                    team.id,
                    agent.id,
                    { instructions: event.target.value },
                  )}
                />
              </label>
            </div>
          </section>
        )}
        </div>

        <section className="management-policy-section">
          <h3>项目范围</h3>
          <div className="management-choice-row">
            <button
              aria-pressed={team.projectScope === "all"}
              type="button"
              onClick={() => updateTeam(team.id, { projectScope: "all" })}
            >
              <Check aria-hidden="true" size={13} />
              全部项目
            </button>
            <button
              aria-pressed={team.projectScope === "selected"}
              type="button"
              onClick={() => updateTeam(team.id, { projectScope: "selected" })}
            >
              <Check aria-hidden="true" size={13} />
              指定项目
            </button>
          </div>
        </section>
      </div>

    </aside>
  );
}

function AgentConfigurationPane({
  agent,
  teams,
}: {
  agent: AgentProfile;
  teams: AgentTeam[];
}): ReactElement {
  const updateAgent = useAgentDirectoryStore((state) => state.updateAgent);
  const memberships = teams.filter((team) => team.memberIds.includes(agent.id));

  return (
    <aside className="agent-configuration-pane" aria-label={`${agent.name} 配置`}>
      <div className="management-detail-heading">
        <AgentAvatar avatar={agent.avatar} size="large" status={agent.status} />
        <div>
          <h2>{agent.name}</h2>
        </div>
        <button
          aria-pressed={agent.enabled}
          className="management-toggle"
          data-enabled={agent.enabled}
          disabled={agent.isDefault}
          type="button"
          onClick={() => updateAgent(agent.id, { enabled: !agent.enabled })}
        >
          {agent.enabled ? "已启用" : "已停用"}
        </button>
      </div>

      <div className="management-detail-body">
        <div className="agent-editor-grid">
          <div className="management-form">
          <div className="management-form__row">
            <label>
              <span>名称</span>
              <input
                value={agent.name}
                onChange={(event) => updateAgent(agent.id, { name: event.target.value })}
              />
            </label>
            <label>
              <span>角色</span>
              <input
                value={agent.role}
                onChange={(event) => updateAgent(agent.id, { role: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>用途说明</span>
            <input
              value={agent.description}
              onChange={(event) => updateAgent(agent.id, { description: event.target.value })}
            />
          </label>
          <label>
            <span>核心指令</span>
            <textarea
              rows={5}
              value={agent.instructions}
              onChange={(event) => updateAgent(agent.id, { instructions: event.target.value })}
            />
          </label>
          </div>

          <div className="agent-policy-column">
            <AvatarEditor agent={agent} onUpdate={(patch) => updateAgent(agent.id, patch)} />

          <section className="management-policy-section">
            <h3>模型策略</h3>
            <div className="management-choice-row management-choice-row--three">
              {(["inherit", "auto", "fixed"] as const).map((strategy) => (
                <button
                  key={strategy}
                  aria-pressed={agent.modelStrategy === strategy}
                  type="button"
                  onClick={() => updateAgent(agent.id, {
                    model: strategy === "auto" ? "团队自动选择" : agent.model,
                    modelStrategy: strategy,
                  })}
                >
                  <Check aria-hidden="true" size={13} />
                  {MODEL_STRATEGY_LABEL[strategy]}
                </button>
              ))}
            </div>
          </section>

          <CapabilityEditor agent={agent} onUpdate={(patch) => updateAgent(agent.id, patch)} />

          <PermissionEditor agent={agent} onUpdate={(patch) => updateAgent(agent.id, patch)} />

          <section className="management-policy-section">
            <h3>所在团队</h3>
            <div className="management-tag-list">
              {memberships.length === 0 ? <span>未加入团队</span> : memberships.map((team) => (
                <span key={team.id}><UsersRound aria-hidden="true" size={12} />{team.name}</span>
              ))}
            </div>
          </section>
          </div>
        </div>
      </div>
    </aside>
  );
}

const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function AvatarEditor({
  agent,
  onUpdate,
}: {
  agent: AgentProfile;
  onUpdate: (patch: Partial<AgentProfile>) => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) return;

    const extensionSupported = /\.(jpe?g|png|svg|webp)$/i.test(file.name);
    if ((!SUPPORTED_AVATAR_TYPES.has(file.type) && !extensionSupported)
      || file.size > MAX_AVATAR_FILE_BYTES) {
      setError(file.size > MAX_AVATAR_FILE_BYTES
        ? "图片不能超过 2 MB"
        : "请选择 SVG、PNG、JPEG 或 WebP 图片");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setError("无法读取所选图片");
        return;
      }
      setError(null);
      onUpdate({ avatar: { dataUrl: reader.result, fileName: file.name, kind: "image" } });
    });
    reader.addEventListener("error", () => setError("无法读取所选图片"));
    reader.readAsDataURL(file);
  }

  return (
    <section className="management-policy-section agent-avatar-editor-section">
      <h3>头像</h3>
      <div className="agent-avatar-editor">
        <div className="agent-avatar-editor__preview">
          <AgentAvatar avatar={agent.avatar} size="large" status={agent.status} />
          <span>{agent.avatar.kind === "image" ? agent.avatar.fileName : "预设图标"}</span>
        </div>
        <div className="agent-avatar-presets" aria-label="预设 Agent 图标">
          {AGENT_AVATAR_ICON_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = agent.avatar.kind === "icon" && agent.avatar.icon === option.id;
            return (
              <button
                key={option.id}
                aria-label={option.label}
                aria-pressed={selected}
                title={option.label}
                type="button"
                onClick={() => {
                  setError(null);
                  onUpdate({ avatar: { icon: option.id, kind: "icon" } });
                }}
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="agent-avatar-actions">
        <label className="agent-avatar-upload">
          <ImagePlus aria-hidden="true" size={14} />
          选择 SVG 或图片
          <input
            accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp"
            type="file"
            onChange={handleFileChange}
          />
        </label>
        {agent.avatar.kind === "image" ? (
          <button
            className="agent-avatar-reset"
            type="button"
            onClick={() => onUpdate({ avatar: { icon: "bot", kind: "icon" } })}
          >
            <RotateCcw aria-hidden="true" size={13} />
            恢复图标
          </button>
        ) : null}
      </div>
      {error === null ? null : <p className="agent-avatar-error" role="alert">{error}</p>}
    </section>
  );
}

function CapabilityEditor({
  agent,
  onUpdate,
}: {
  agent: AgentProfile;
  onUpdate: (patch: Partial<AgentProfile>) => void;
}): ReactElement {
  function toggleId(key: "mcpServerIds" | "skillIds", id: string): void {
    const current = agent[key];
    onUpdate({ [key]: current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id] });
  }

  return (
    <section className="management-policy-section">
      <div className="management-policy-section__heading">
        <h3>Skill 与 MCP</h3>
        <Select
          value={agent.capabilityScope}
          onValueChange={(value) => onUpdate({ capabilityScope: value as AgentCapabilityScope })}
        >
          <SelectTrigger className="capability-scope-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit_all">继承全部</SelectItem>
            <SelectItem value="custom">自定义范围</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {agent.capabilityScope === "inherit_all" ? (
        <div className="capability-inherited-note">
          <Layers3 aria-hidden="true" size={15} />
          默认可以发现并按需使用所有已启用的 Skill、插件和 MCP。
        </div>
      ) : (
        <div className="capability-picker-grid">
          <CapabilityGroup
            icon={Sparkles}
            items={AVAILABLE_SKILLS}
            label="Skills"
            selectedIds={agent.skillIds}
            onToggle={(id) => toggleId("skillIds", id)}
          />
          <CapabilityGroup
            icon={Boxes}
            items={AVAILABLE_MCP_SERVERS}
            label="MCP Servers"
            selectedIds={agent.mcpServerIds}
            onToggle={(id) => toggleId("mcpServerIds", id)}
          />
        </div>
      )}
    </section>
  );
}

function CapabilityGroup({
  icon: Icon,
  items,
  label,
  onToggle,
  selectedIds,
}: {
  icon: typeof Sparkles;
  items: readonly { id: string; name: string }[];
  label: string;
  onToggle: (id: string) => void;
  selectedIds: string[];
}): ReactElement {
  return (
    <fieldset className="capability-group">
      <legend><Icon aria-hidden="true" size={13} />{label}</legend>
      {items.map((item) => (
        <label key={item.id}>
          <input
            checked={selectedIds.includes(item.id)}
            type="checkbox"
            onChange={() => onToggle(item.id)}
          />
          <span>{item.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

const PERMISSION_TOOL_OPTIONS: readonly { label: string; value: AgentPermissionTool }[] = [
  { label: "执行命令", value: "run_command" },
  { label: "写入文件", value: "write_file" },
  { label: "删除文件", value: "delete_file" },
  { label: "替换文件内容", value: "replace_in_file" },
  { label: "应用 Patch", value: "apply_patch" },
];

function PermissionEditor({
  agent,
  onUpdate,
}: {
  agent: AgentProfile;
  onUpdate: (patch: Partial<AgentProfile>) => void;
}): ReactElement {
  const rules = agent.permissions?.allow ?? [];

  function updateRule(index: number, patch: Partial<AgentPermissionRule>): void {
    onUpdate({
      permissions: {
        allow: rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
      },
    });
  }

  function addRule(): void {
    if (rules.length >= 200) return;
    onUpdate({
      permissions: {
        allow: [...rules, { pattern: "*", tool: "run_command" }],
      },
    });
  }

  function removeRule(index: number): void {
    onUpdate({ permissions: { allow: rules.filter((_rule, ruleIndex) => ruleIndex !== index) } });
  }

  return (
    <section className="management-policy-section" aria-labelledby={`agent-permissions-${agent.id}`}>
      <div className="management-policy-section__heading">
        <div>
          <h3 id={`agent-permissions-${agent.id}`}>权限规则</h3>
          <p className="settings-section__description">
            只保存明确允许的规则；未匹配的命令或敏感操作仍需审批。命令末尾可使用 * 做前缀匹配。
          </p>
        </div>
        <button disabled={rules.length >= 200} type="button" onClick={addRule}>
          <Plus aria-hidden="true" size={13} />
          添加规则
        </button>
      </div>
      {rules.length === 0 ? (
        <p className="capability-inherited-note">当前 Agent 没有持久化允许规则。</p>
      ) : (
        <div className="agent-permission-rule-list">
          {rules.map((rule, index) => (
            <div className="agent-permission-rule" key={`${rule.tool}-${index}`}>
              <select
                aria-label="权限工具"
                value={rule.tool}
                onChange={(event) => updateRule(index, {
                  tool: event.target.value as AgentPermissionTool,
                })}
              >
                {PERMISSION_TOOL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                aria-label="权限匹配规则"
                placeholder={rule.tool === "run_command" ? "例如：mvn package *" : "例如：src/* 或 *"}
                value={rule.pattern}
                onChange={(event) => updateRule(index, { pattern: event.target.value })}
              />
              <IconButton
                label="删除权限规则"
                size="compact"
                onClick={() => removeRule(index)}
              >
                <Trash2 aria-hidden="true" size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TeamMemberAdd({
  agents,
  team,
}: {
  agents: AgentProfile[];
  team: AgentTeam;
}): ReactElement {
  const addAgentToTeam = useAgentDirectoryStore((state) => state.addAgentToTeam);
  const availableAgents = agents.filter((agent) => !team.memberIds.includes(agent.id));
  const [agentId, setAgentId] = useState(availableAgents[0]?.id ?? "");
  const effectiveAgentId = availableAgents.some((agent) => agent.id === agentId)
    ? agentId
    : availableAgents[0]?.id ?? "";

  if (availableAgents.length === 0) {
    return <div className="team-member-add team-member-add--complete">全部 Agent 已加入</div>;
  }

  return (
    <div className="team-member-add">
      <Select value={effectiveAgentId} onValueChange={setAgentId}>
        <SelectTrigger aria-label="选择要加入的 Agent"><SelectValue /></SelectTrigger>
        <SelectContent>
          {availableAgents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        aria-label="添加团队成员"
        className="team-member-add__button"
        title="添加团队成员"
        type="button"
        onClick={() => addAgentToTeam(team.id, effectiveAgentId)}
      >
        <Plus aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function TeamMemberRow({
  agent,
  isLead,
  isSelected,
  onSelect,
  team,
}: {
  agent: AgentProfile;
  isLead: boolean;
  isSelected: boolean;
  onSelect: () => void;
  team: AgentTeam;
}): ReactElement {
  const removeAgentFromTeam = useAgentDirectoryStore((state) => state.removeAgentFromTeam);
  const memberRole = team.memberConfigurations[agent.id]?.role.trim() || agent.role;

  return (
    <div className="team-member-row" data-selected={isSelected}>
      <button
        aria-pressed={isSelected}
        className="team-member-row__main"
        type="button"
        onClick={onSelect}
      >
        <AgentAvatar avatar={agent.avatar} status={agent.status} />
        <span>
          <span className="team-member-row__title">
            <strong>{agent.name}</strong>
            {isLead ? <small>Lead</small> : null}
          </span>
          <small>{memberRole}</small>
        </span>
        <ChevronRight aria-hidden="true" size={14} />
      </button>
      <button
        aria-label={`从团队移除 ${agent.name}`}
        className="team-member-row__remove"
        disabled={isLead}
        title={isLead ? "请先更换 Team Lead" : `从团队移除 ${agent.name}`}
        type="button"
        onClick={() => removeAgentFromTeam(team.id, agent.id)}
      >
        <Trash2 aria-hidden="true" size={13} />
      </button>
    </div>
  );
}

function PaneHeading({
  action,
  label,
  value,
}: {
  action?: ReactElement;
  label: string;
  value?: number;
}): ReactElement {
  return (
    <div className="team-section-heading">
      <h2>{label}</h2>
      {action ?? (value === undefined ? null : <span>{value}</span>)}
    </div>
  );
}

function TeamMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="team-metric">
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ManagementEmpty({
  icon: Icon,
  label,
}: {
  icon: typeof UsersRound;
  label: string;
}): ReactElement {
  return (
    <div className="team-management-empty">
      <Icon aria-hidden="true" size={22} />
      <span>{label}</span>
    </div>
  );
}
