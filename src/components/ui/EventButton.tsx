/**
 * Event button: primary CTA, secondary, danger, and ghost variants.
 * All buttons use the event design system tokens.
 */

import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface EventButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "event-button--primary",
  secondary: "event-button--secondary",
  danger: "event-button--danger",
  ghost: "event-button--ghost",
};

export default function EventButton({
  variant = "primary",
  children,
  className = "",
  ...props
}: EventButtonProps) {
  return (
    <button
      type="button"
      className={`event-button ${variantClass[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
