import {
  AgentDatabase, contextSearchTerms, distinctiveContextTerms, rankStrongContextMatches,
  type StoredContextMessage,
} from "./agent-database.js";
import { ThreadLog } from "./thread-log.js";

/** Reads canonical model history independently of evicted UI projections. */
export class ThreadLogReferenceReader {
  public constructor(private readonly database: AgentDatabase, private readonly log: ThreadLog) {}

  public getConversation(id: string) { return this.database.getConversation(id); }

  public getContextCheckpoint(id: string) {
    const checkpoint = this.log.readContext(id)?.checkpoint;
    return checkpoint === undefined || checkpoint === null ? null : { ...checkpoint, conversationId: id };
  }

  public listContextMessagesPage(input: Parameters<AgentDatabase["listContextMessagesPage"]>[0]): StoredContextMessage[] {
    const messages = this.messages(input.conversationId);
    const page: StoredContextMessage[] = [];
    for (let index = messages.length - 1; index >= 0 && page.length < input.limit; index--) {
      const message = messages[index]!;
      if ((input.beforeSequence === undefined || message.sequence < input.beforeSequence)
        && (input.afterSequence === undefined || message.sequence > input.afterSequence)) page.push(message);
    }
    return page.reverse();
  }

  public countContextMessages(input: Parameters<AgentDatabase["countContextMessages"]>[0]): number {
    let count = 0;
    for (const message of this.messages(input.conversationId)) {
      if ((input.beforeSequence === undefined || message.sequence < input.beforeSequence)
        && (input.afterSequence === undefined || message.sequence > input.afterSequence)) count++;
    }
    return count;
  }

  public searchContextMessages(input: Parameters<AgentDatabase["searchContextMessages"]>[0]): StoredContextMessage[] {
    const terms = contextSearchTerms(input.query);
    const limit = input.limit ?? 24;
    const candidates: StoredContextMessage[] = [];
    for (const message of this.messages(input.conversationId)) {
      if ((input.beforeSequence !== undefined && message.sequence >= input.beforeSequence)
        || input.excludeSequences?.includes(message.sequence)) continue;
      const text = `${message.content}\n${JSON.stringify(message.toolCalls)}`.toLocaleLowerCase();
      if (!terms.some((term) => text.includes(term.toLocaleLowerCase()))) continue;
      candidates.push(message);
      if (candidates.length > 100) candidates.shift();
    }
    return rankStrongContextMatches(candidates, distinctiveContextTerms(input.query), terms, limit);
  }

  public listContextMessagesForRun(runId: string, conversationId: string): StoredContextMessage[] {
    this.database.getConversation(conversationId);
    return this.log.readRunContext(conversationId, runId);
  }

  private messages(id: string): StoredContextMessage[] {
    this.database.getConversation(id);
    return this.log.readContext(id)?.messages ?? [];
  }
}
