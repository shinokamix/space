import { _electron as electron, expect, test } from "@playwright/test";

test("opens the workspace", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
  const application = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  try {
    const window = await application.firstWindow();
    await expect(window.getByText("SPACE", { exact: true })).toBeVisible();
    await expect(window.getByLabel("Workspace canvas")).toBeVisible();
  } finally {
    await application.close();
  }
});
