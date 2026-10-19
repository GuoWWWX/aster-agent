import type { ProjectSession, TeamInstanceNavigatorGroup } from "./project-session-model.js";
import type { NavigatorSortOption } from "./navigator-types.js";

export const NAVIGATOR_SORT_OPTIONS: readonly {
  label: string;
  value: NavigatorSortOption;
}[] = [
  { label: "自定义顺序", value: "custom" },
  { label: "名称 A-Z", value: "name-ascending" },
  { label: "名称 Z-A", value: "name-descending" },
];

export const navigatorLabelCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function sortNavigatorItems<Item>(
  items: readonly Item[],
  option: NavigatorSortOption,
  getLabel: (item: Item) => string,
): Item[] {
  if (option === "custom") return [...items];
  return [...items].sort((left, right) => {
    const comparison = navigatorLabelCollator.compare(getLabel(left), getLabel(right));
    return option === "name-descending" ? -comparison : comparison;
  });
}

export function sessionTreeMatchesQuery(
  session: ProjectSession,
  normalizedQuery: string,
): boolean {
  return session.title.toLocaleLowerCase().includes(normalizedQuery);
}

export function teamGroupMatchesQuery(
  group: TeamInstanceNavigatorGroup,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  return group.instance.name.toLocaleLowerCase().includes(normalizedQuery)
    || group.team.name.toLocaleLowerCase().includes(normalizedQuery)
    || group.team.description.toLocaleLowerCase().includes(normalizedQuery)
    || group.members.some(({ profile }) =>
      profile.name.toLocaleLowerCase().includes(normalizedQuery)
      || profile.role.toLocaleLowerCase().includes(normalizedQuery)
      || group.team.memberConfigurations[profile.id]?.role
        .toLocaleLowerCase().includes(normalizedQuery) === true
    );
}

export function reorderIdentifiers(
  identifiers: readonly string[],
  sourceId: string,
  targetId: string,
  position: "after" | "before",
): string[] {
  const reordered = identifiers.filter((identifier) => identifier !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  if (targetIndex < 0) return [...identifiers];
  reordered.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourceId);
  return reordered;
}
