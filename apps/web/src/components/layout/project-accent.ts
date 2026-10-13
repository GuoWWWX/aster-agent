import type { ProjectSummary } from "@agent/protocol";

// Deliberately curated pairs: project identity never changes the action/status palette.
const PROJECT_PALETTES = [
  ["#477b78", "#596ba4"],
  ["#5b7198", "#796da2"],
  ["#92735e", "#a07a87"],
  ["#657d61", "#50878c"],
  ["#7f6991", "#687aa2"],
  ["#927c52", "#74865f"],
] as const;

export function projectAccent(project: Pick<ProjectSummary, "id"> | null): readonly [string, string] | null {
  if (project === null) return null;
  let hash = 2166136261;
  for (const character of project.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return PROJECT_PALETTES[(hash >>> 0) % PROJECT_PALETTES.length] ?? PROJECT_PALETTES[0];
}
