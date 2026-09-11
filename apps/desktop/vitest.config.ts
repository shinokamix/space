import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src/renderer/src", import.meta.url).pathname },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
