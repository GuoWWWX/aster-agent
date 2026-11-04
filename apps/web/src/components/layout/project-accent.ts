import type { ProjectSummary } from "@agent/protocol";

// Deliberately curated pairs: project identity never changes the action/status palette.
const PROJECT_PALETTES = [
  ["#df676d", "#c87191"], // red
  ["#c8bb57", "#a7b65e"], // yellow
  ["#6095e1", "#7a84d1"], // blue
  ["#62b181", "#55a49c"], // green
  ["#ca77b2", "#d37f95"], // pink
  ["#e58d50", "#cf7668"], // orange
  ["#d7a64e", "#c68b57"], // amber
  ["#9dbb5b", "#7bb071"], // lime
  ["#48aba8", "#5997b5"], // teal
  ["#58accb", "#6b95c2"], // cyan
  ["#7d7bdd", "#9f78c9"], // indigo
  ["#a275ce", "#bd79b6"], // purple
  ["#d78095", "#bf83b0"], // rose
  ["#b66a8e", "#a57dbb"], // berry
  ["#bb8667", "#cc9875"], // copper
  ["#7b9eb7", "#8c95be"], // slate
] as const;

function projectHash(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function projectAccent(
  project: Pick<ProjectSummary, "id"> | null,
  projects: readonly Pick<ProjectSummary, "id">[] = [],
): readonly [string, string] | null {
  if (project === null) return null;
  // Resolve collisions in a stable ID order; switching or reordering projects cannot change colors.
  const ids = [...new Set([...projects.map((item) => item.id), project.id])].sort();
  const used = new Set<number>();
  let slot = 0;
  let band = 0;
  for (const [index, id] of ids.entries()) {
    band = Math.floor(index / PROJECT_PALETTES.length);
    // A small workspace gets clearly separated red/yellow/blue/green/pink first.
    const baseCount = index % PROJECT_PALETTES.length < 5 ? 5 : PROJECT_PALETTES.length;
    let paletteIndex = projectHash(id) % baseCount;
    while (used.has(band * PROJECT_PALETTES.length + paletteIndex)) paletteIndex = (paletteIndex + 1) % baseCount;
    slot = band * PROJECT_PALETTES.length + paletteIndex;
    used.add(slot);
    if (id === project.id) break;
  }
  const palette = PROJECT_PALETTES[slot % PROJECT_PALETTES.length] ?? PROJECT_PALETTES[0];
  if (band === 0) return palette;
  const next = PROJECT_PALETTES[(slot + 1) % PROJECT_PALETTES.length] ?? PROJECT_PALETTES[0];
  const basePercent = 100 - 35 * band / (band + 1);
  return [
    `color-mix(in srgb, ${palette[0]} ${basePercent}%, ${next[0]})`,
    `color-mix(in srgb, ${palette[1]} ${basePercent}%, ${next[1]})`,
  ];
}
