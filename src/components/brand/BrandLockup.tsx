/**
 * Brand lockup component: HARMONIC BEACON mark + wordmark.
 * Used across landing, login, and operator surfaces.
 */

interface BrandLockupProps {
  href?: string;
  className?: string;
}

export default function BrandLockup({ href = "/", className = "" }: BrandLockupProps) {
  const Tag = href ? "a" : "span";
  return (
    <Tag
      href={href}
      className={`brand-lockup ${className}`}
    >
      <span className="brand-lockup__mark" aria-hidden="true">
        &#10022;
      </span>
      <span>
        HARMONIC
        <br />
        <i className="brand-lockup__accent">BEACON</i>
      </span>
    </Tag>
  );
}
