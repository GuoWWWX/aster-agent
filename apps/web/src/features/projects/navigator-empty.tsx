import { Folder } from "lucide-react";
import type { ReactElement } from "react";
import { LoadingState } from "../../components/ui/loading.js";

export function NavigatorEmpty({
  actionLabel,
  label,
  loading = false,
  onAction,
}: {
  actionLabel?: string;
  label: string;
  loading?: boolean;
  onAction?: () => void;
}): ReactElement {
  if (loading) return <LoadingState label={label} compact className="w-full" />;
  return (
    <div className="project-navigator__empty" data-loading={String(loading)}>
      <Folder aria-hidden="true" size={19} />
      <p>{label}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
