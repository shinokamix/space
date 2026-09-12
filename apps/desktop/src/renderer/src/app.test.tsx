import { describe, expect, it } from "vite-plus/test";

import { useWorkspaceStore } from "./store/workspace";

describe("workspace store", () => {
  it("starts with a runtime and terminal node", () => {
    expect(useWorkspaceStore.getState().nodes.map(({ id }) => id)).toEqual(["runtime", "terminal"]);
  });
});
