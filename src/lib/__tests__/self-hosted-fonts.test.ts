import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const fonts = {
  "src/app/fonts/cormorant-garamond/CormorantGaramond-wght.woff2":
    "e4c3c3eb566c07afee0b54301b984dc3e5e7e1dd1218a528e61133ed84a7647d",
  "src/app/fonts/cormorant-garamond/CormorantGaramond-Italic-wght.woff2":
    "14d1519ed9320432e1782e0b90435647827937a41222e99531f449c981090303",
  "src/app/fonts/syne/Syne-wght.woff2":
    "3426a96623df5fba636f48774ae899f5b9136b67a8418f49c04d110cf30a585b",
  "src/app/fonts/space-mono/SpaceMono-Regular.woff2":
    "76ba939dbd8fe9d6cb0519633d0e92878e21e6c8cb6cd635f67fc344c242a4c9",
  "src/app/fonts/space-mono/SpaceMono-Bold.woff2":
    "2ef5a6968e7045c138da05c95e583025c967b698a3c2bd3d9ea177ba7209934b",
} as const;

describe("self-hosted application fonts", () => {
  it("pins every approved binary and retains its OFL license", () => {
    for (const [relativePath, expectedHash] of Object.entries(fonts)) {
      const bytes = readFileSync(join(root, relativePath));
      expect(createHash("sha256").update(bytes).digest("hex"), relativePath).toBe(expectedHash);
    }

    for (const family of ["cormorant-garamond", "syne", "space-mono"]) {
      expect(
        readFileSync(join(root, `src/app/fonts/${family}/OFL.txt`), "utf8"),
      ).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  it("uses only local font loading in the root layout", () => {
    const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('from "next/font/local"');
    expect(layout).not.toContain("next/font/google");
    expect(layout).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
  });
});
