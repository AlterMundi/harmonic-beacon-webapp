/**
 * PortalOrbit — CSS-only concentric ring motif.
 *
 * Used selectively on public surfaces (landing hero, pre-join states).
 * Hidden from screen readers when decorative.
 * Completely static under prefers-reduced-motion.
 */

interface PortalOrbitProps {
  children?: React.ReactNode;
  decorative?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_MAP = {
  sm: "max-w-[200px]",
  md: "max-w-[320px]",
  lg: "max-w-[440px]",
};

export default function PortalOrbit({
  children,
  decorative = true,
  className = "",
  size = "md",
}: PortalOrbitProps) {
  return (
    <div
      className={`portal-orbit ${SIZE_MAP[size]} ${className}`}
      aria-hidden={decorative ? "true" : undefined}
    >
      {/* Concentric rings */}
      <div className="portal-orbit__ring portal-orbit__ring--one" />
      <div className="portal-orbit__ring portal-orbit__ring--two" />
      <div className="portal-orbit__ring portal-orbit__ring--three" />

      {/* Orbiting points */}
      <div className="portal-orbit__point portal-orbit__point--gold animate-portal-orbit" />
      <div
        className="portal-orbit__point portal-orbit__point--cyan animate-portal-orbit"
        style={{ animationDelay: "-8s" }}
      />
      <div
        className="portal-orbit__point portal-orbit__point--pink animate-portal-orbit"
        style={{ animationDelay: "-16s" }}
      />

      {/* Center content */}
      {children && <div className="portal-orbit__center">{children}</div>}
    </div>
  );
}
