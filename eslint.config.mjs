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
    "test-results/**",
    "playwright-report/**",
    // Raw partner deliveries (gitignored, hash-recorded in the per-game
    // intake docs). They are evidence of what was delivered, not our
    // source — holding them to our rules is noise we can never act on.
    "intake/**",
  ]),
  {
    rules: {
      // Underscore prefix marks intentionally unused contract params.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // LeakTracker patches EventTarget.prototype with function expressions
      // (needs dynamic `this`), so a self-alias is structurally required.
      "@typescript-eslint/no-this-alias": [
        "error",
        { allowedNames: ["tracker"] },
      ],
    },
  },
]);

export default eslintConfig;
