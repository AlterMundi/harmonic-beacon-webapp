import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Browser-gate artifacts contain bundled third-party JavaScript and are
    // outputs, not source. Keeping them out also makes `npm run lint` stable
    // regardless of whether Playwright ran first.
    "playwright-report/**",
    "test-results/**",
    // Byte-exact canonical snapshot. Its digest is the source-of-truth gate;
    // lint fixes would make the vendored bytes diverge from upstream.
    "public/assets/hb-global-nav.js",
    // Compiled output of the playlist-bot, checked in so the deploy does not
    // need a build step for it. It is generated CommonJS, so linting it reports
    // `require()` against a rule written for our source — five errors that no
    // edit to our code can fix. Linting build output tells you about the
    // compiler, not the codebase.
    "services/*/dist/**",
  ]),
]);

export default eslintConfig;
