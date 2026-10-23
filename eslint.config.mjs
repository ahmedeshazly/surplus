// Owner: R1. Flat config. Encodes the repo rules from AGENT_CONTEXT.md as lint errors.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Money is integer cents. toFixed is display formatting only (apps/web).
      "no-restricted-properties": [
        "error",
        {
          property: "toFixed",
          message:
            "No float money math. Use integer cents. toFixed is allowed only in apps/web for display.",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "tests/**/*.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // packages/engine must stay pure and synchronous (AGENT_CONTEXT.md Section 5).
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.{test,spec}.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Engine must be pure: pass asOf in, do not read the clock.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Engine must be pure: pass asOf in, do not read the clock.",
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Engine must be deterministic: no randomness.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "http",
                "https",
                "better-sqlite3",
                "ai",
                "@ai-sdk/*",
                "@paypal/*",
              ],
              message: "Engine must not do I/O, database access or LLM calls.",
            },
          ],
        },
      ],
    },
  },
);
