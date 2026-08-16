import { HB_LISSAJOUS_PATH } from "@/brand/canonical/hb-mark";

interface HarmonicBeaconMarkProps {
  /** A single dimension preserves the canonical square viewBox. */
  size?: number;
  className?: string;
  /** Supply a label only when the mark is not accompanied by visible text. */
  label?: string;
}

/** Canonical 3:2 Lissajous mark. Transform and non-uniform sizing are intentionally unavailable. */
export default function HarmonicBeaconMark({
  size = 32,
  className = "",
  label,
}: HarmonicBeaconMarkProps) {
  const accessible = Boolean(label);

  return (
    <svg
      className={`hb-brand__mark ${className}`}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      role={accessible ? "img" : undefined}
      aria-label={label}
      aria-hidden={accessible ? undefined : true}
      focusable="false"
    >
      <path
        d={HB_LISSAJOUS_PATH}
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
