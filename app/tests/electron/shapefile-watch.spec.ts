import { expect, test, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { cp, mkdtemp, rm } from "node:fs/promises";
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
const shapefileFixtureDirectory = resolve(
  appRoot,
  "tests",
  "fixtures",
  "shapefiles",
  "simple-pointz",
);

test("opens a shapefile directory and loads the editor", async () => {
  const watchDirectory = await createShapefileFixture();
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

    await expect(
      page.getByRole("button", { name: "Stop Watching" }),
    ).toBeVisible();
    await expect(page.getByTestId("shapefile-summary-sample-route")).toBeVisible();
    await expect(page.getByTestId("shapefile-document-title")).toHaveText(
      "sample-route",
    );
    await expect(page.getByTestId("point-record-range")).toHaveText(
      "Showing 1-3 of 3 points",
    );
    await expect(page.getByText("No Shapefile Selected")).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

test("saves a DBF edit and keeps it after reload", async () => {
  const watchDirectory = await createShapefileFixture();
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
    const labelCell = page.getByTestId("dbf-cell-0-LABEL").locator("input");

    await expect(labelCell).toHaveValue("A");
    await labelCell.fill("Z");
    await expect(page.getByText("Unsaved")).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Unsaved")).toHaveCount(0);
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByTestId("dbf-cell-0-LABEL").locator("input")).toHaveValue(
      "Z",
    );
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

async function openWatchMode(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "geodash" })).toBeVisible();
  await page.getByRole("link", { name: "Shapefile Tools", exact: true }).click();
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

  await expect(page.getByTestId("shapefile-summary-sample-route")).toBeVisible();
  await expect(page.getByTestId("shapefile-document-title")).toHaveText(
    "sample-route",
  );
}

async function createShapefileFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "geodash-shapefile-playwright-"));
  await cp(shapefileFixtureDirectory, directory, { recursive: true });
  return directory;
}
