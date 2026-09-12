import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useCanvasStore } from "./modules/canvas/store/canvas-store";

describe("workspace store", () => {
  beforeEach(() => useCanvasStore.setState({ nodes: [] }));

  it("starts with an empty canvas", () => {
    expect(useCanvasStore.getState().nodes).toEqual([]);
  });

  it("creates a terminal at the requested position", () => {
    useCanvasStore.getState().addNode({ position: { x: 120, y: 240 }, type: "terminal" });

    expect(useCanvasStore.getState().nodes).toEqual([
      expect.objectContaining({
        type: "terminal",
        position: { x: 120, y: 240 },
        data: { title: "Terminal" },
      }),
    ]);
  });
});
