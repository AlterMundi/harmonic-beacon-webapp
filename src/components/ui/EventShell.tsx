/**
 * Event shell: the root container for public attendee-facing pages.
 * Phase 5: Wider desktop support (up to ~1120px), asymmetrical layouts.
 */

interface EventShellProps {
  children: React.ReactNode;
  className?: string;
  centered?: boolean;
  wide?: boolean;
}

export default function EventShell({
  children,
  className = "",
  centered = false,
  wide = false,
}: EventShellProps) {
  return (
    <div className={`event-shell ${className}`}>
      <div
        className={`relative z-10 mx-auto flex min-h-screen flex-col px-6 py-12 ${centered ? "justify-center" : ""} ${wide ? "max-w-[1120px]" : "max-w-2xl"}`}
        style={{
          paddingTop: "max(48px, var(--safe-top) + 24px)",
          paddingBottom: "max(48px, var(--safe-bottom) + 24px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
