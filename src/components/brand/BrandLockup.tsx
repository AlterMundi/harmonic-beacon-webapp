import HarmonicBeaconBrand from "./HarmonicBeaconBrand";

/**
 * Compatibility wrapper for the public Live lockup.
 *
 * The small API stays stable for the landing and staff login while the
 * rendered identity comes from the canonical, provenance-pinned brand
 * primitives shared with Listener.
 */

interface BrandLockupProps {
  href?: string;
  className?: string;
}

export default function BrandLockup({ href = "/", className = "" }: BrandLockupProps) {
  return <HarmonicBeaconBrand href={href} className={`brand-lockup ${className}`} markSize={34} />;
}
