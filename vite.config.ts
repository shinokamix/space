import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": "vp check --fix --no-error-on-unmatched-pattern",
    "*.{css,html,json,jsonc,md,yaml,yml}": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      "coverage",
      "dist",
      "node_modules",
      "out",
      "playwright-report",
      "pnpm-lock.yaml",
      "release",
      "test-results",
      "*.tsbuildinfo",
    ],
    sortImports: {
      groups: [
        ["type-builtin", "value-builtin"],
        ["type-external", "value-external"],
        ["type-internal", "value-internal"],
        [
          "type-parent",
          "type-sibling",
          "type-index",
          "value-parent",
          "value-sibling",
          "value-index",
        ],
        "style",
        "unknown",
      ],
      internalPattern: ["@/", "@space/"],
      newlinesBetween: true,
    },
    sortPackageJson: {},
    sortTailwindcss: {
      functions: ["clsx", "cn", "cva"],
      stylesheet: "./apps/desktop/src/renderer/src/styles.css",
    },
  },
  lint: {
    categories: {
      correctness: "error",
      perf: "warn",
      suspicious: "warn",
    },
    ignorePatterns: [
      "coverage",
      "dist",
      "node_modules",
      "out",
      "playwright-report",
      "release",
      "test-results",
      "*.tsbuildinfo",
    ],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "playwright", specifier: "eslint-plugin-playwright" },
    ],
    plugins: ["eslint", "import", "jsx-a11y", "oxc", "react", "typescript", "unicorn", "vitest"],
    rules: {
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "typescript/consistent-return": "off",
      "typescript/no-explicit-any": "error",
      "unicorn/consistent-function-scoping": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["apps/desktop/src/renderer/**"],
        env: { browser: true },
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["node:*", "electron", "@space/runtime", "@space/runtime/*"],
                  message:
                    "Renderer code must use the typed preload bridge or @space/protocol instead of importing privileged runtime modules.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/desktop/tests/e2e/**"],
        rules: {
          "playwright/expect-expect": "error",
          "playwright/missing-playwright-await": "error",
          "playwright/no-focused-test": "error",
          "playwright/no-skipped-test": "error",
          "playwright/no-wait-for-timeout": "error",
        },
      },
      {
        files: ["apps/desktop/scripts/**", "apps/desktop/tests/e2e/**", "scripts/**"],
        rules: { "eslint/no-await-in-loop": "off" },
      },
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "apps/desktop/tests/e2e/**"],
        rules: { "typescript/no-unsafe-type-assertion": "off" },
      },
    ],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
});
