/**
 * Event field: text input styled for the event design system.
 */

import { useId, type InputHTMLAttributes } from "react";

interface EventFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
}

export default function EventField({
  label,
  error,
  className = "",
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: EventFieldProps) {
  const generatedId = useId();
  const fieldId = id || `event-field-${generatedId.replace(/:/g, "")}`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--cream)]">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        className="event-field"
        aria-invalid={error ? true : invalid}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
