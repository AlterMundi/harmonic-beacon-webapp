/**
 * Operational panel: compact container for operator surfaces.
 * Same brand family, utilitarian presentation.
 */

import { useId } from "react";

interface OperationalPanelProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export default function OperationalPanel({
  children,
  className = "",
  title,
}: OperationalPanelProps) {
  const generatedId = useId();
  const titleId = title ? `operational-panel-${generatedId.replace(/:/g, "")}` : undefined;
  return (
    <section className={`operational-panel ${className}`} aria-labelledby={titleId}>
      {title && (
        <h3 id={titleId} className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}
