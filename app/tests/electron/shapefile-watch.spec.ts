import { expect, test, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("switching shapefiles resets point pagination to the first page", async () => {
  const watchDirectory = await mkdtemp(join(tmpdir(), "geodash-shapefile-pages-"));
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

    await waitForBackend();
    await buildPointShapefileFixture(watchDirectory, "three-pages", 600);
    await buildPointShapefileFixture(watchDirectory, "two-pages", 260);

    await openDirectoryWatcher(page);

    await page.getByTestId("shapefile-summary-three-pages").click();
    await expect(page.getByTestId("shapefile-document-title")).toHaveText(
      "three-pages",
    );
    await expect(page.getByTestId("point-record-range")).toHaveText(
      "Showing 1-250 of 600 points",
    );

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("point-record-range")).toHaveText(
      "Showing 501-600 of 600 points",
    );

    await page.getByTestId("shapefile-summary-two-pages").click();

    await expect(page.getByTestId("shapefile-document-title")).toHaveText(
      "two-pages",
    );
    await expect(page.getByTestId("point-record-range")).toHaveText(
      "Showing 1-250 of 260 points",
    );
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

async function openDirectoryWatcher(page: Page) {
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
}

async function openWatchMode(page: Page) {
  await openDirectoryWatcher(page);
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

async function waitForBackend() {
  await expect
    .poll(async () => {
      try {
        const response = await fetch("http://127.0.0.1:3001/health");
        return response.ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
}

async function buildPointShapefileFixture(
  directory: string,
  name: string,
  recordCount: number,
) {
  const records = Array.from({ length: recordCount }, (_, index) => ({
    number: index + 1,
    geometry: {
      type: "PointZ" as const,
      x: index,
      y: index * 2,
      z: 0,
      m: 0,
    },
  }));
  const fields = [
    {
      name: "LABEL",
      fieldType: "C" as const,
      length: 12,
      decimalCount: 0,
    },
  ];
  const rows = Array.from({ length: recordCount }, (_, index) => [`P${index + 1}`]);

  const response = await fetch("http://127.0.0.1:3001/api/shapefiles/build", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      records,
      fields,
      rows,
      prj: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to build shapefile fixture ${name} (${response.status})`);
  }

  const built = await response.json() as {
    shp_b64: string;
    shx_b64: string;
    dbf_b64: string;
    prj_b64?: string;
  };
  const stemPath = join(directory, name);

  await writeFile(`${stemPath}.shp`, Buffer.from(built.shp_b64, "base64"));
  await writeFile(`${stemPath}.shx`, Buffer.from(built.shx_b64, "base64"));
  await writeFile(`${stemPath}.dbf`, Buffer.from(built.dbf_b64, "base64"));
  if (built.prj_b64) {
    await writeFile(`${stemPath}.prj`, Buffer.from(built.prj_b64, "base64"));
  }
}
