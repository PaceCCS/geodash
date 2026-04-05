import { expect, test, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, "..", "..");
const mainScriptPath = join(appRoot, "dist-electron", "main.js");
const rendererEntryPath = "http://127.0.0.1:3100";
const presetFixtureDirectory = resolve(
  appRoot,
  "..",
  "core",
  "network-engine",
  "test-data",
  "preset1",
);

test("launches the Electron app and enters watch mode", async () => {
  const watchDirectory = await createWatchFixture();
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [mainScriptPath],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererEntryPath,
      GEODASH_DISABLE_DEVTOOLS: "1",
      GEODASH_TEST_PICK_DIRECTORY: watchDirectory,
    },
  });

  try {
    const page = await electronApp.firstWindow();

    await openWatchMode(page);
    await expect(page.getByText("Preset 1")).toBeVisible();
    await expect(page.getByText("Auto-saving")).toBeVisible();
    await expect(
      page.getByText("No recent activity."),
    ).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

test("repositioning a branch logs the move event", async () => {
  const watchDirectory = await createWatchFixture();
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [mainScriptPath],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererEntryPath,
      GEODASH_DISABLE_DEVTOOLS: "1",
      GEODASH_TEST_PICK_DIRECTORY: watchDirectory,
    },
  });

  try {
    const page = await electronApp.firstWindow();

    await openWatchMode(page);
    const initialToml = await readFile(join(watchDirectory, "branch-4.toml"), "utf8");

    await dragBranch(page, "branch-4");

    await expect(
      page.getByText(/Branch Branch 4 \(branch-4\) moved:/).first(),
    ).toBeVisible();

    await expect.poll(
      async () => readFile(join(watchDirectory, "branch-4.toml"), "utf8"),
    )
      .not.toBe(initialToml);
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

test("leaving watch mode via navigation clears the activity log", async () => {
  const watchDirectory = await createWatchFixture();
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [mainScriptPath],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererEntryPath,
      GEODASH_DISABLE_DEVTOOLS: "1",
      GEODASH_TEST_PICK_DIRECTORY: watchDirectory,
    },
  });

  try {
    const page = await electronApp.firstWindow();

    await openWatchMode(page);
    await dragBranch(page, "branch-4");

    await expect(
      page.getByText(/Branch Branch 4 \(branch-4\) moved:/).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "Home", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "geodash" }).first(),
    ).toBeVisible();
    await expect(page.getByText("No recent activity.")).toBeVisible();
    await expect(
      page.getByText(/Branch Branch 4 \(branch-4\) moved:/),
    ).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

async function openWatchMode(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "geodash" })).toBeVisible();
  await page.getByRole("link", { name: "Network Editor", exact: true }).click();
  const selectDirectoryButtons = page.getByRole("button", { name: "Select Directory" });
  const stopWatchingButton = page.getByRole("button", { name: "Stop Watching" });

  await expect(page.getByText("No Directory Selected")).toBeVisible();
  await expect(selectDirectoryButtons.last()).toBeVisible();
  await selectDirectoryButtons.last().click();

  try {
    await expect(stopWatchingButton).toBeVisible({ timeout: 3_000 });
  } catch {
    await selectDirectoryButtons.first().click();
    await expect(stopWatchingButton).toBeVisible();
  }

  await expect(page.getByText("Auto-saving")).toBeVisible();
}

async function dragBranch(page: Page, branchId: string) {
  const branchNodeContent = page.getByTestId(`branch-node-${branchId}`);
  await expect(branchNodeContent).toBeVisible();

  const branchNode = page.locator(`.react-flow__node[data-id="${branchId}"]`);
  await expect(branchNode).toBeVisible();

  const box = await branchNode.boundingBox();
  if (!box) {
    throw new Error(`Unable to determine ${branchId} position in the canvas`);
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 80, { steps: 16 });
  await page.mouse.up();
}

async function createWatchFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "geodash-playwright-"));
  await cp(presetFixtureDirectory, directory, { recursive: true });
  return directory;
}
