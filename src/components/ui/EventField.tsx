/**
 * Event field: text input styled for the event design system.
 */

import type { InputHTMLAttributes } from "react";

interface EventFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
}

export default function EventField({
  label,
  error,
  className = "",
  id,
  ...props
}: EventFieldProps) {
  const fieldId = id || (typeof label === "string" ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--cream)]">
          {label}
        </label>
      )}
      <input id={fieldId} className="event-field" {...props} />
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
