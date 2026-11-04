import { ArrowDownAZ, ArrowDownUp, ArrowDownZA, ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import type { NavigatorSortOption } from "./navigator-types.js";

export function NavigatorSortIcon({
  option,
}: { option: NavigatorSortOption }): ReactElement {
  if (option === "name-ascending") return <ArrowDownAZ aria-hidden="true" size={15} />;
  if (option === "name-descending") return <ArrowDownZA aria-hidden="true" size={15} />;
  return <ArrowDownUp aria-hidden="true" size={15} />;
}

export function NavigatorGroupHeader({
  action,
  expanded,
  icon,
  label,
  onToggle,
}: {
  action?: {
    disabled?: boolean;
    icon: ReactElement;
    label: string;
    onClick: () => void;
  };
  expanded: boolean;
  icon: ReactElement;
  label: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <div className="project-navigator__project-row">
      <button
        aria-expanded={expanded}
        aria-label={expanded ? `收起 ${label}` : `展开 ${label}`}
        className="project-navigator__project-button project-navigator__group-button"
        title={expanded ? "收起对话" : "展开对话"}
        type="button"
        onClick={onToggle}
      >
        {icon}
        <span>{label}</span>
        {expanded ? (
          <ChevronDown
            aria-hidden="true"
            className="project-navigator__group-chevron"
            size={14}
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="project-navigator__group-chevron"
            size={14}
          />
        )}
      </button>
      {action === undefined ? null : (
        <div className="project-navigator__project-actions">
          <button
            aria-label={action.label}
            disabled={action.disabled}
            title={action.label}
            type="button"
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        </div>
      )}
    </div>
  );
}
