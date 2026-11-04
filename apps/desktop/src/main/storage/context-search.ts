import { type StoredContextMessage } from "./conversation-storage-contracts.js";

function contextSearchRuns(query: string): string[] {
  return [...new Set(
    (query.match(/[\p{Script=Han}]+|[\p{L}\p{N}_./\\:@#-]+/gu) ?? [])
      .map((run) => run.trim())
      .filter((run) => run.length >= 1),
  )];
}

function isDistinctiveContextTerm(term: string): boolean {
  return (/^[\p{Script=Han}]+$/u.test(term) && term.length >= 4)
    || /[._/\\:@#-]|\d/u.test(term)
    || /[a-z][A-Z]|_/u.test(term);
}

export function contextSearchTerms(query: string): string[] {
  const runs = contextSearchRuns(query);
  const terms: string[] = [];
  const append = (term: string): void => {
    const normalized = term.trim();
    if (normalized.length < 1 || terms.includes(normalized)) return;
    terms.push(normalized);
  };
  for (const run of runs.filter(isDistinctiveContextTerm)) append(run);
  for (const run of runs) append(run);
  for (const run of runs) {
    if (/^[\p{Script=Han}]+$/u.test(run)) {
      for (let index = 0; index + 3 <= run.length; index += 1) {
        append(run.slice(index, index + 3));
      }
      if (run.length <= 8) {
        for (let index = 0; index + 2 <= run.length; index += 1) {
          append(run.slice(index, index + 2));
        }
      }
      continue;
    }
    append(run);
  }
  return terms.slice(0, 24);
}

export function distinctiveContextTerms(query: string): string[] {
  return contextSearchRuns(query).filter(isDistinctiveContextTerm);
}

export function likePattern(term: string): string {
  return `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function conversationSearchSnippet(content: string, query: string, maxCharacters = 320): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxCharacters) return compact;
  const index = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, (index < 0 ? 0 : index) - Math.floor(maxCharacters / 3));
  const end = Math.min(compact.length, start + maxCharacters);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end).trim()}${end < compact.length ? "…" : ""}`;
}

export function rankStrongContextMatches(
  messages: readonly StoredContextMessage[],
  distinctiveTerms: readonly string[],
  terms: readonly string[],
  limit: number,
): StoredContextMessage[] {
  const normalizedTerms = terms.map((term) => term.toLocaleLowerCase());
  const normalizedDistinctiveTerms = distinctiveTerms.map((term) => term.toLocaleLowerCase());
  const minimumMatches = normalizedTerms.length <= 2
    ? 1
    : Math.min(4, Math.max(2, Math.ceil(normalizedTerms.length / 4)));
  const candidates = messages.map((message, index) => {
    const searchableText = `${message.content}\n${JSON.stringify(message.toolCalls)}`
      .toLocaleLowerCase();
    return {
      distinctiveMatch: normalizedDistinctiveTerms.some((term) => searchableText.includes(term)),
      index,
      matchedTerms: normalizedTerms.reduce(
        (count, term) => count + (searchableText.includes(term) ? 1 : 0),
        0,
      ),
      message,
    };
  });
  const strongRunIds = new Set(
    candidates
      .filter((candidate) =>
        candidate.distinctiveMatch || candidate.matchedTerms >= minimumMatches
      )
      .map((candidate) => candidate.message.runId)
      .filter((runId): runId is string => runId !== null),
  );
  return candidates
    .filter((candidate) =>
      candidate.distinctiveMatch
      || candidate.matchedTerms >= minimumMatches
      || (candidate.message.runId !== null && strongRunIds.has(candidate.message.runId))
    )
    .sort((left, right) =>
      Number(right.distinctiveMatch) - Number(left.distinctiveMatch)
      || right.matchedTerms - left.matchedTerms
      || left.index - right.index
    )
    .slice(0, limit)
    .map((candidate) => candidate.message);
}
