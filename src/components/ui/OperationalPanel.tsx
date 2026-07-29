/**
 * Operational panel: compact container for operator surfaces.
 * Same brand family, utilitarian presentation.
 */

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
  return (
    <div className={`operator-panel ${className}`}>
      {title && (
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
