import { describe, expect, it } from "vite-plus/test";
import { createRuntimeServer } from "./server.js";

describe("runtime server", () => {
  it("creates an HTTP server", () => {
    const server = createRuntimeServer();
    expect(server.listening).toBe(false);
    server.close();
  });
});
