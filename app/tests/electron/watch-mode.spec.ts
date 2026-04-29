import { expect, test, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
const exampleFixtureDirectory = resolve(appRoot, "..", "workingfiles", "example");

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

    await openNetworkDirectory(page, watchDirectory);
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

test("shows selected network directory files in the left sidebar tree", async () => {
  const watchDirectory = await createExampleWatchFixture();
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

    await openNetworkDirectory(page, watchDirectory);
    await expect(page.getByText("Network Files")).toBeVisible();
    const fileTree = page.getByTestId("sidebar-file-tree");
    await expect(fileTree).toBeVisible();
    await expect(page.getByText("This directory is empty.")).toHaveCount(0);
    await expect(fileTree).toHaveAttribute("data-loaded-paths", /config\.toml/);
    await expect(fileTree).toHaveAttribute("data-loaded-paths", /assets\//);
    await expect(fileTree).toHaveAttribute(
      "data-loaded-paths",
      /assets\/spirit\/KP_Points_1m\.shp/,
    );

    const transientFile = join(watchDirectory, "transient-sidebar-file.txt");
    await writeFile(transientFile, "temporary");
    await expect(fileTree).toHaveAttribute(
      "data-loaded-paths",
      /transient-sidebar-file\.txt/,
    );

    await unlink(transientFile);
    await expect(fileTree).not.toHaveAttribute(
      "data-loaded-paths",
      /transient-sidebar-file\.txt/,
    );

    await writeFile(join(watchDirectory, ".DS_Store"), "ignored");
    await expect(fileTree).not.toHaveAttribute("data-loaded-paths", /\.DS_Store/);
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

test("uses preferred directory on first network directory dialog open", async () => {
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [mainScriptPath],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererEntryPath,
      GEODASH_DISABLE_DEVTOOLS: "1",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate((preferredDirectory) => {
      window.localStorage.setItem(
        "app-settings",
        JSON.stringify({
          state: {
            preferredDirectory,
            useLastSelectionParent: false,
          },
          version: 0,
        }),
      );
    }, exampleFixtureDirectory);
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("app-settings")),
      )
      .toContain(exampleFixtureDirectory);

    await openNetworkDirectoryDialogWithShortcut(page);
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("app-settings")),
      )
      .toContain(exampleFixtureDirectory);
    await expect(page.getByRole("textbox", { name: "Directory path" })).toHaveValue(
      `${exampleFixtureDirectory}/`,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await openNetworkDirectoryDialogWithShortcut(page);
    await expect(page.getByRole("textbox", { name: "Directory path" })).toHaveValue(
      `${exampleFixtureDirectory}/`,
    );
  } finally {
    await electronApp.close();
  }
});

async function openNetworkDirectoryDialogWithShortcut(page: Page) {
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Open Directory/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Select Network Directory" }),
  ).toBeVisible();
}

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

    await openNetworkDirectory(page, watchDirectory);
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

    await openNetworkDirectory(page, watchDirectory);
    await dragBranch(page, "branch-4");

    await expect(
      page.getByText(/Branch Branch 4 \(branch-4\) moved:/).first(),
    ).toBeVisible();

    await page.goto(rendererEntryPath);

    await expect(page.getByRole("heading", { name: "Network hierarchy" })).toBeVisible();
    await expect(page.getByText("No recent activity.")).toBeVisible();
    await expect(
      page.getByText(/Branch Branch 4 \(branch-4\) moved:/),
    ).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

test("editing a block label through the flow UI persists to TOML", async () => {
  const watchDirectory = await createExampleWatchFixture();
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

    await openNetworkDirectory(page, watchDirectory);
    await page.getByTestId("branch-node-branch-2").getByText("special pipe").click();
    await page.keyboard.press("Meta+E");

    const editor = page.getByRole("dialog", { name: /Block editor:/ });
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox").first().fill("renamed pipe");
    await editor.getByRole("button", { name: "Apply Changes" }).click();

    await expect(page.getByTestId("branch-node-branch-2").getByText("renamed pipe")).toBeVisible();
    await expect.poll(
      async () => readFile(join(watchDirectory, "branch-2.toml"), "utf8"),
    ).toContain('label = "renamed pipe"');
  } finally {
    await electronApp.close();
    await rm(watchDirectory, { recursive: true, force: true });
  }
});

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

async function openNetworkDirectory(page: Page, directoryPath: string) {
  await page.waitForLoadState("domcontentloaded");
  await page.goto(
    `${rendererEntryPath}/network/watch?directory=${encodeURIComponent(directoryPath)}`,
  );
  await expect(page.getByText("Auto-saving")).toBeVisible();
}

async function createWatchFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "geodash-playwright-"));
  await cp(presetFixtureDirectory, directory, { recursive: true });
  return directory;
}

async function createExampleWatchFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "geodash-example-playwright-"));
  await cp(exampleFixtureDirectory, directory, { recursive: true });
  return directory;
}
