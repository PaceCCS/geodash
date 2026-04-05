import { defineConfig } from "@playwright/test";

const rendererEntryPath = "http://127.0.0.1:3100";

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
    command: "bunx vite dev --strictPort --port 3100 --host 127.0.0.1",
    url: rendererEntryPath,
    cwd: ".",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
