import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/install-simulation.test.ts"],
    testTimeout: 5 * 60_000,   // 5 min per test (network-dependent)
    hookTimeout: 10 * 60_000,  // 10 min for beforeAll (npm install + browser download)
    // Sequential — single daemon for all tests
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
