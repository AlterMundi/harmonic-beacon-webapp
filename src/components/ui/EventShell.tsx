/**
 * Event shell: the root container for public attendee-facing pages.
 * Provides the dark atmosphere, safe-area padding, and max-width constraint.
 */

interface EventShellProps {
  children: React.ReactNode;
  className?: string;
  centered?: boolean;
}

export default function EventShell({
  children,
  className = "",
  centered = false,
}: EventShellProps) {
  return (
    <div className={`event-shell ${className}`}>
      <div
        className={`relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-12 ${centered ? "justify-center" : ""}`}
        style={{ paddingTop: "max(48px, var(--safe-top) + 24px)", paddingBottom: "max(48px, var(--safe-bottom) + 24px)" }}
      >
        {children}
      </div>
    </div>
  );
}
