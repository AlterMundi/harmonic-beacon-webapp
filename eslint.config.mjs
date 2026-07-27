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
    // Compiled output of the playlist-bot, checked in so the deploy does not
    // need a build step for it. It is generated CommonJS, so linting it reports
    // `require()` against a rule written for our source — five errors that no
    // edit to our code can fix. Linting build output tells you about the
    // compiler, not the codebase.
    "services/*/dist/**",
  ]),
]);

export default eslintConfig;
