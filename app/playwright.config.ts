import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/electron",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev:web",
    url: "http://127.0.0.1:3000",
    cwd: ".",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
