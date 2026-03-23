import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Run tests sequentially — phases must not overlap (daemon port conflicts)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
