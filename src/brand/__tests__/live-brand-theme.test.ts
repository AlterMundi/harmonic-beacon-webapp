import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("Live canonical brand boundary", () => {
  it("maps canonical tokens only inside explicit Live surface shells", () => {
    const css = source("src/app/globals.css");
    const eventTheme = css.match(
      /CANONICAL PUBLIC LIVE THEME[\s\S]*?:where\(\.event-shell, \.live-ops-shell\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(eventTheme).toBeDefined();
    expect(eventTheme).toContain("--night: var(--hb-bg-0)");
    expect(eventTheme).toContain("--paper: var(--hb-bone)");
    expect(eventTheme).toContain("--gold: var(--hb-gold)");
    expect(eventTheme).toContain("font-family: var(--hb-font-sans)");

    const opsLayout = source("src/app/ops/layout.tsx");
    expect(opsLayout).toContain("live-ops-shell");
    expect(opsLayout).not.toContain('className="event-shell');
  });

  it("keeps the public landing free of the previous neon accents", () => {
    const landing = source("src/app/page.tsx");

    expect(landing).not.toMatch(/var\(--(?:cyan|pink|lime|violet)\)/);
    expect(landing).not.toMatch(/rgba\((?:124,\s*234,\s*255|255,\s*143,\s*200|200,\s*255,\s*122)/);
    expect(landing).not.toContain("style={{");
    expect(landing).toContain("event-hero-accent");
  });

  it("renders the compatibility lockup through the canonical component", () => {
    const lockup = source("src/components/brand/BrandLockup.tsx");

    expect(lockup).toContain('import HarmonicBeaconBrand from "./HarmonicBeaconBrand"');
    expect(lockup).toContain("<HarmonicBeaconBrand");
    expect(lockup).not.toContain("&#10022;");
  });

  it("preserves distinct warm room-presence and speaking semantics", () => {
    const css = source("src/app/globals.css");

    for (const tone of ["0", "1", "2", "3"]) {
      expect(css).toMatch(
        new RegExp(`\\.event-shell \\.stage-tile\\[data-presence-tone="${tone}"\\] \\.stage-tile__presence \\{`),
      );
    }
    expect(css).toMatch(/\.event-shell \.stage-tile--protagonist \{[\s\S]*?201, 162, 78/);
    expect(css).toMatch(/\.event-shell \.stage-tile--speaking \{[\s\S]*?226, 187, 167/);
    expect(css).not.toMatch(
      /\.event-shell \.stage-tile--protagonist,\s*\.event-shell \.stage-tile--speaking/,
    );
  });

  it("uses scoped warm glass with an opaque compatibility fallback", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain("--live-glass-blur: 12px");
    expect(css).toMatch(/\.event-shell \.event-card \{[\s\S]*?backdrop-filter: blur\(var\(--live-glass-blur\)\)/);
    expect(css).toMatch(/\.live-ops-shell > nav \{[\s\S]*?backdrop-filter:/);
    expect(css).toMatch(/\[role="dialog"\] \{[\s\S]*?backdrop-filter: blur\(18px\)/);
    expect(css).toMatch(/\.event-field \{[\s\S]*?rgba\(22, 18, 13, 0\.76\)/);
    expect(css).toContain("@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))");
    expect(css).toMatch(/@supports not[\s\S]*?--bg-card: var\(--hb-bg-1\)/);
    expect(css).toMatch(/event-alert--danger[\s\S]*?#f0b5a8/);
    expect(css).toMatch(/event-alert--success[\s\S]*?#c4d8b9/);
    expect(css).not.toMatch(/\.event-field \{[^}]*backdrop-filter/);
    expect(css).not.toMatch(/\.lang-control \{[^}]*backdrop-filter/);
    expect(css).not.toMatch(/\.operational-panel \{[^}]*backdrop-filter/);
    expect(css).not.toMatch(/div:has\(> iframe\) \{[^}]*backdrop-filter/);
    expect(css).not.toMatch(/\.stage-tile__identity \{[^}]*backdrop-filter/);
  });

  it("keeps modal operations above the shared product header", () => {
    const css = source("src/app/globals.css");
    const opsLayout = source("src/app/ops/layout.tsx");

    expect(css).toMatch(
      /body:has\(\.live-ops-shell \[role="dialog"\]:not\(\.hidden\)\) > hb-global-nav \{[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/,
    );
    expect(opsLayout).toContain("'Operaciones de eventos'");
    expect(opsLayout).toContain("'Event operations'");
  });
});
