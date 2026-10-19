import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { IconButton } from "../../../components/ui/icon-button.js";

export function SettingsDirectoryDeleteButton({
  disabled = false,
  disabledReason,
  label,
  onDelete,
}: {
  disabled?: boolean;
  disabledReason?: string;
  label: string;
  onDelete: () => void;
}): ReactElement {
  return (
    <span
      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/directory:pointer-events-auto group-hover/directory:opacity-100 group-has-[:focus-visible]/directory:pointer-events-auto group-has-[:focus-visible]/directory:opacity-100"
      data-directory-action=""
      title={disabledReason}
    >
      <IconButton
        className="bg-[var(--app-hover)] group-data-[active=true]/directory:bg-[var(--app-selection)]"
        disabled={disabled}
        label={label}
        size="compact"
        tooltip={disabledReason ?? label}
        variant="destructive"
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" size={15} />
      </IconButton>
    </span>
  );
}
