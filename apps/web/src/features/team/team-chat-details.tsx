import { useEffect, useRef, useState, type ReactElement } from "react";
import { Search, UsersRound } from "lucide-react";
import type { ConversationSummary, ReadTeamChatInput, TeamChatMember, TeamChatMessage, TeamInstanceView } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { getUserErrorMessage } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { LoadingState } from "../../components/ui/loading.js";
import { TeamConfigurationPane } from "../settings/agent-team-settings.js";
import { formatConversationDateTime } from "../chat/chat-message-meta.js";
import { AgentAvatar, SubagentAvatar } from "./agent-avatar.js";

export type TeamChatDetailsSection = "info" | "history" | "settings";
const sections = { info: "群资料", history: "聊天记录", settings: "群设置" } as const;
const control = "min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-2 py-1 text-[length:var(--app-font-size-control)]";

/** A tool tab inside the existing resizable sidebar; no second drawer or history store. */
export function TeamChatDetails({ agentClient, instance, active, section, onSectionChanged, onOpenMember, onRename }: {
  agentClient: AgentClient; instance: TeamInstanceView; active: boolean; section: TeamChatDetailsSection;
  onSectionChanged: (section: TeamChatDetailsSection) => void;
  onOpenMember: (conversation: ConversationSummary) => void; onRename: (name: string) => Promise<boolean>;
}): ReactElement {
  const agents = useAgentDirectoryStore(state => state.agents);
  const team = useAgentDirectoryStore(state => state.teams.find(item => item.id === instance.teamId));
  const [members, setMembers] = useState<TeamChatMember[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState(team?.leadAgentId ?? "");
  const [name, setName] = useState(instance.name);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState("");
  const [sender, setSender] = useState("all");
  const [from, setFrom] = useState(""); const [until, setUntil] = useState("");
  const [messages, setMessages] = useState<TeamChatMessage[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const appliedSearch = useRef<ReadTeamChatInput | null>(null);
  const searchVersion = useRef(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void Promise.all([agentClient.getTeamChatMembers({ teamInstanceId: instance.id }), agentClient.listConversationHierarchy()])
      .then(([roster, hierarchy]) => { if (!disposed) { setMembers(roster); setConversations(hierarchy); setError(null); } })
      .catch(reason => { if (!disposed) setError(getUserErrorMessage(reason, "群资料读取失败")); });
    return () => { disposed = true; };
  }, [agentClient, instance.id, active, revision]);
  useEffect(() => () => { searchVersion.current++; }, []);
  const search = async (more = false): Promise<void> => {
    const version = ++searchVersion.current;
    setSearching(true); setError(null);
    try {
      const criteria: ReadTeamChatInput = more && appliedSearch.current !== null ? appliedSearch.current : {
        teamInstanceId: instance.id, query,
        ...(sender === "all" ? {} : { senderConversationId: sender === "user" ? null : sender }),
        ...(from === "" ? {} : { createdAfter: new Date(`${from}T00:00:00`).toISOString() }),
        ...(until === "" ? {} : { createdBefore: new Date(`${until}T23:59:59.999`).toISOString() }),
      };
      const page = await agentClient.readTeamChat({ ...criteria, ...(more && cursor !== null ? { beforeSequence: cursor } : {}) });
      if (version !== searchVersion.current) return;
      appliedSearch.current = criteria;
      setMessages(previous => more ? [...new Map([...(previous ?? []), ...page.messages].map(message => [message.id, message])).values()].sort((a, b) => b.sequence - a.sequence) : page.messages.toReversed());
      setCursor(page.nextBeforeSequence);
    } catch (reason) { if (version === searchVersion.current) setError(getUserErrorMessage(reason, "聊天记录查询失败")); }
    finally { if (version === searchVersion.current) setSearching(false); }
  };
  return <section aria-label="群资料与设置" className="flex h-full min-h-0 min-w-0 flex-1 flex-col text-[length:var(--app-font-size-control)]">
    <div role="tablist" aria-label="群聊管理" className="flex shrink-0 gap-[5px] border-b border-[var(--app-border)] p-[5px]">
      {Object.entries(sections).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id}
        className={`min-w-0 flex-1 rounded-[var(--app-radius)] px-2 py-1 ${section === id ? "bg-[var(--app-hover)] text-[var(--app-accent)]" : "hover:bg-[var(--app-hover)]"}`}
        onClick={() => onSectionChanged(id === "info" ? "info" : id === "history" ? "history" : "settings")}>{label}</button>)}
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-[10px]">
      {error === null ? null : <p role="alert" className="mb-[5px] break-words text-[var(--app-destructive)]">{error}
        {section === "history" ? <button className="ml-[5px] underline" type="button" disabled={searching} onClick={() => void search()}>重试查询</button>
          : section === "info" ? <button className="ml-[5px] underline" type="button" onClick={() => setRevision(value => value + 1)}>刷新群资料</button> : null}
      </p>}
      {section === "info" ? <div className="flex min-w-0 flex-col gap-[10px]">
        <header className="flex min-w-0 items-center gap-[5px]"><UsersRound size={22} className="shrink-0" /><div className="min-w-0"><strong className="block truncate">{instance.name}</strong><span className="text-[var(--app-muted-foreground)]">{instance.scope === "global" ? "全局群聊" : instance.scope === "project" ? "项目群聊" : "对话群聊"} · {members.filter(member => !member.isArchived).length} 位成员</span></div></header>
        {team?.description ? <p className="m-0 whitespace-pre-wrap break-words">{team.description}</p> : null}
        <h3 className="m-0 font-medium">群成员</h3>
        <ul className="m-0 flex list-none flex-col gap-[5px] p-0">{members.map(member => {
          const conversation = conversations.find(item => item.id === member.conversationId);
          const agent = agents.find(item => item.id === conversation?.agentId);
          const configuration = agent === undefined ? undefined : team?.memberConfigurations[agent.id];
          return <li key={member.conversationId} className="min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] p-[5px]">
            <button type="button" aria-label={`打开成员 ${member.name} 的对话`} disabled={conversation === undefined} onClick={() => { if (conversation) onOpenMember(conversation); }}
              className="flex w-full min-w-0 items-center gap-[5px] text-left text-[var(--app-accent)] hover:underline">
              {agent ? <AgentAvatar avatar={agent.avatar} size="compact" /> : <SubagentAvatar icon={conversation?.avatarIcon ?? null} seed={member.conversationId} size="compact" />}
              <span className="min-w-0 flex-1 truncate">{member.name}</span><small className="shrink-0 text-[var(--app-muted-foreground)]">{member.isLead ? "负责人" : member.isArchived ? "已归档" : conversation?.activeRunId ? "工作中" : "成员"}</small>
            </button>
            <p className="my-[5px] break-words text-[var(--app-muted-foreground)]">{member.role}</p>
            <details><summary className="cursor-pointer text-[var(--app-muted-foreground)]">身份与团队职责</summary><div className="flex flex-col gap-[5px] whitespace-pre-wrap break-words py-[5px]">
              <p className="m-0">Agent：{agent?.name ?? member.name} · {agent?.role ?? member.role}</p>
              {agent?.description ? <p className="m-0">{agent.description}</p> : null}
              <p className="m-0">团队职责：{configuration?.role || member.role}</p>
              {configuration?.instructions ? <p className="m-0">团队内要求：{configuration.instructions}</p> : null}
              {agent?.instructions ? <details><summary className="cursor-pointer">基础提示词</summary><p className="m-0 pt-[5px]">{agent.instructions}</p></details> : null}
            </div></details>
          </li>;
        })}</ul>
        <button type="button" className={control} onClick={() => onSectionChanged("settings")}>编辑群设置</button>
        <button type="button" className={control} onClick={() => setRevision(value => value + 1)}>刷新群资料</button>
      </div> : section === "history" ? <div className="flex min-w-0 flex-col gap-[10px]">
        <form aria-label="查询聊天记录" className="flex min-w-0 flex-col gap-[5px]" onSubmit={event => { event.preventDefault(); void search(); }}>
          <input aria-label="消息关键词" placeholder="搜索群消息" maxLength={200} className={control} value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="消息发送者" className={control} value={sender} onChange={event => setSender(event.target.value)}><option value="all">所有发送者</option><option value="user">我</option>{members.map(member => <option key={member.conversationId} value={member.conversationId}>{member.name}{member.isArchived ? "（已归档）" : ""}</option>)}</select>
          <div className="grid min-w-0 grid-cols-2 gap-[5px]"><label className="min-w-0">开始日期<input aria-label="开始日期" type="date" className={`${control} block w-full`} value={from} onChange={event => setFrom(event.target.value)} /></label><label className="min-w-0">结束日期<input aria-label="结束日期" type="date" className={`${control} block w-full`} value={until} onChange={event => setUntil(event.target.value)} /></label></div>
          <button type="submit" className={`${control} inline-flex items-center justify-center gap-[5px] text-[var(--app-accent)]`} disabled={searching}><Search size={14} />查询</button>
        </form>
        {searching ? <LoadingState label="正在查询聊天记录" /> : null}
        {messages === null ? <p className="m-0 text-[var(--app-muted-foreground)]">可按关键词、发送者和日期查询。留空查询最近消息。</p> : messages.length === 0 ? <p className="m-0 text-[var(--app-muted-foreground)]">{cursor === null ? "没有符合条件的消息" : "这一批未找到匹配，可继续查询更早记录。"}</p> : null}
        <ol className="m-0 flex list-none flex-col gap-[5px] p-0">{messages?.map(message => <li key={message.id}><button type="button" className="flex w-full min-w-0 flex-col gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] p-2 text-left hover:bg-[var(--app-hover)]" title="定位到群中原消息"
          onClick={() => useWorkbenchUiStore.getState().openTeamChat({ instanceId: instance.id, messageId: message.id })}>
          <span className="flex w-full min-w-0 gap-[5px]"><strong className="min-w-0 flex-1 truncate">{message.senderConversationId === null ? "我" : message.senderName}</strong><time className="shrink-0 text-[var(--app-muted-foreground)]">{formatConversationDateTime(message.createdAt)}</time></span>
          <span className="line-clamp-4 whitespace-pre-wrap break-words">{message.content}</span><span className="text-[var(--app-accent)]">查看原消息</span>
        </button></li>)}</ol>
        {cursor === null ? null : <button type="button" className={control} disabled={searching} onClick={() => void search(true)}>继续查询更早记录</button>}
      </div> : <div className="flex min-w-0 flex-col gap-[10px]">
        <form className="flex min-w-0 flex-col gap-[5px]" onSubmit={event => { event.preventDefault(); setError(null); setRenaming(true); void onRename(name).then(saved => { if (!saved) setError("群名保存失败，请重试。"); }).catch(reason => setError(getUserErrorMessage(reason, "群名保存失败"))).finally(() => setRenaming(false)); }}>
          <label className="flex min-w-0 flex-col gap-[5px]">当前群名称<input aria-label="当前群名称" required maxLength={120} value={name} className={control} onChange={event => setName(event.target.value)} /></label>
          <button type="submit" className={control} disabled={renaming || name.trim().length === 0}>保存群名</button>
        </form>
        <p className="m-0 text-[var(--app-muted-foreground)]">下面复用“{team?.name ?? "团队"}”的配置。同一团队的其他群也会使用这些负责人、职责和协作规则；已开始的运行保留原快照。</p>
        {team === undefined ? <p>团队配置已不可用，群历史仍可查询。</p> : <div className="min-w-0 [container-type:inline-size] [container-name:agent-team-settings]"><TeamConfigurationPane compact team={team} agents={agents} agent={agents.find(agent => agent.id === selectedAgentId)} onSelectMember={setSelectedAgentId}
          onOpenAgent={agentId => useWorkbenchUiStore.getState().openAgentPromptWorkspace({ agentId, title: `${agents.find(agent => agent.id === agentId)?.name ?? "Agent"} 提示词` })} /></div>}
      </div>}
    </div>
  </section>;
}
