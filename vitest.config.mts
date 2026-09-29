// Unit tests for app code (server modules). Kept separate from vite.config.ts
// so the Remix plugin doesn't load under vitest.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
