import { describe, expect, test } from "bun:test";
import { resolveNetworkPath } from "./network";
import { resolve } from "node:path";

describe("resolveNetworkPath", () => {
  test("returns null for undefined", () => {
    expect(resolveNetworkPath(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(resolveNetworkPath("")).toBeNull();
  });

  test("returns absolute path as-is", () => {
    expect(resolveNetworkPath("/absolute/path")).toBe("/absolute/path");
  });

  test("resolves relative path against CWD", () => {
    const result = resolveNetworkPath("relative/dir");
    expect(result).toBe(resolve(process.cwd(), "relative/dir"));
  });
});
