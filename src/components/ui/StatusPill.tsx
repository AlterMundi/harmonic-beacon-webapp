/**
 * Status pill: compact label for states (live, success, warning, danger, request, brand).
 */

type PillVariant = "live" | "success" | "warning" | "danger" | "request" | "brand";

interface StatusPillProps {
  variant: PillVariant;
  children: React.ReactNode;
  dot?: boolean;
}

const variantClass: Record<PillVariant, string> = {
  live: "status-pill--live",
  success: "status-pill--success",
  warning: "status-pill--warning",
  danger: "status-pill--danger",
  request: "status-pill--request",
  brand: "status-pill--brand",
};

const dotClass: Record<PillVariant, string> = {
  live: "status-pill__dot--live",
  success: "status-pill__dot--success",
  warning: "status-pill__dot--warning",
  danger: "status-pill__dot--danger",
  request: "status-pill__dot--danger",
  brand: "status-pill__dot--success",
};

export default function StatusPill({ variant, children, dot = true }: StatusPillProps) {
  return (
    <span className={`status-pill ${variantClass[variant]}`}>
      {dot && <span className={`status-pill__dot ${dotClass[variant]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
