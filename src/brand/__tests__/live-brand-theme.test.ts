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
});
