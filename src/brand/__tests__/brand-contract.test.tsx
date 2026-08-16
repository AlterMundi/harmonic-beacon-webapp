// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HB_LISSAJOUS_PATH } from "@/brand/canonical/hb-mark";
import manifest from "@/brand/canonical/manifest.json";
import HarmonicBeaconBrand from "@/components/brand/HarmonicBeaconBrand";
import HarmonicBeaconMark from "@/components/brand/HarmonicBeaconMark";

const root = process.cwd();

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const normalizeCssValue = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "").replace(/0\.(\d+)/g, ".$1");

const customProperties = (css: string) =>
  new Map(
    Array.from(css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [
      name,
      normalizeCssValue(value),
    ]),
  );

afterEach(cleanup);

describe("canonical Harmonic Beacon brand contract", () => {
  it("pins every vendored snapshot and self-hosted font", () => {
    for (const [relativePath, expectedHash] of Object.entries({
      ...manifest.snapshots,
      ...manifest.fonts,
    })) {
      const bytes = readFileSync(join(root, relativePath));
      expect(digest(bytes), relativePath).toBe(expectedHash);
    }

    for (const family of ["cormorant-garamond", "inter"]) {
      expect(readFileSync(join(root, `src/app/fonts/${family}/OFL.txt`), "utf8"))
        .toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  it("maps every canonical visual token to one namespaced application token", () => {
    const canonicalSnapshot = readFileSync(
      join(root, "src/brand/canonical/hb-brand-root.css"),
      "utf8",
    );
    const rootBlock = canonicalSnapshot.slice(canonicalSnapshot.indexOf(":root{"));
    expect(digest(rootBlock)).toBe(manifest.extractedPayloads.canonicalRootBlock);

    const canonical = customProperties(canonicalSnapshot);
    const application = customProperties(
      readFileSync(join(root, "src/styles/hb-brand.css"), "utf8"),
    );
    const aliases: Record<string, string> = {
      "--r-card": "--hb-radius-card",
      "--shadow-card": "--hb-shadow-card",
      "--ease": "--hb-ease",
    };

    for (const [sourceName, sourceValue] of canonical) {
      if (sourceName === "--font-serif" || sourceName === "--font-sans") continue;
      const targetName = aliases[sourceName] ?? sourceName.replace(/^--/, "--hb-");
      expect(application.get(targetName), `${sourceName} -> ${targetName}`).toBe(sourceValue);
    }

    expect(application.get("--hb-font-serif")).toContain("var(--font-cormorant)");
    expect(application.get("--hb-font-sans")).toContain("var(--font-hb-inter)");
  });

  it("consumes the exact canonical path without exposing deformation controls", () => {
    expect(digest(HB_LISSAJOUS_PATH)).toBe(manifest.extractedPayloads.lissajousPath);

    const { rerender } = render(<HarmonicBeaconMark size={48} />);
    const hiddenMark = document.querySelector("svg");
    expect(hiddenMark).toHaveAttribute("width", "48");
    expect(hiddenMark).toHaveAttribute("height", "48");
    expect(hiddenMark).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(hiddenMark).toHaveAttribute("aria-hidden", "true");
    expect(hiddenMark?.querySelector("path")).toHaveAttribute("d", HB_LISSAJOUS_PATH);

    rerender(<HarmonicBeaconMark label="Harmonic Beacon" />);
    expect(screen.getByRole("img", { name: "Harmonic Beacon" })).toBeInTheDocument();
  });

  it("renders an accessible, SSR-safe lockup and motion fallback", () => {
    expect(
      renderToStaticMarkup(<HarmonicBeaconBrand href="https://harmonicbeacon.com/" />),
    ).toContain("Harmonic Beacon");

    render(<HarmonicBeaconBrand href="https://harmonicbeacon.com/" />);
    expect(screen.getByRole("link", { name: "Harmonic Beacon" }))
      .toHaveAttribute("href", "https://harmonicbeacon.com/");

    const css = readFileSync(join(root, "src/styles/hb-brand.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
  });
});
