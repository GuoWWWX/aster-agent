import type { ReactElement, ReactNode } from "react";

export function SettingsSectionHeader({ action, bodyClassName, children, eyebrow, title }: {
  action?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  eyebrow: string;
  title: string;
}): ReactElement {
  return <section className="settings-section" aria-labelledby={`settings-${title}`}>
    <header className="settings-section__header">
      <div className="settings-section__title-row">
        <h2 id={`settings-${title}`}>{title}</h2>
        <p className="settings-section__description">{eyebrow}</p>
      </div>
      {action ?? null}
    </header>
    <div className={`settings-section__body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
  </section>;
}
