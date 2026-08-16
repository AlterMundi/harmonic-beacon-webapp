import HarmonicBeaconMark from "./HarmonicBeaconMark";

interface HarmonicBeaconBrandProps {
  href?: string;
  className?: string;
  markSize?: number;
}

/** Canonical mark + wordmark lockup for Listener and Live public chrome. */
export default function HarmonicBeaconBrand({
  href,
  className = "",
  markSize = 30,
}: HarmonicBeaconBrandProps) {
  const content = (
    <>
      <HarmonicBeaconMark size={markSize} />
      <span className="hb-brand__wordmark">Harmonic Beacon</span>
    </>
  );

  if (href) {
    return (
      <a className={`hb-brand ${className}`} href={href}>
        {content}
      </a>
    );
  }

  return <span className={`hb-brand ${className}`}>{content}</span>;
}
