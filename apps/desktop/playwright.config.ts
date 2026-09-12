import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { trace: "retain-on-failure" },
});
