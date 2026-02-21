import { Hono } from "hono";
import { loadNetwork } from "../services/core";
import { resolveNetworkPath } from "../utils/network";
import { join, resolve, normalize } from "node:path";

export const networkRoutes = new Hono();

/**
 * GET /api/network
 *
 * Load a network and return its node/edge structure.
 *
 * Query parameters:
 *   network – network directory path (absolute or relative to CWD)
 */
/**
 * GET /api/network/assets/:path
 *
 * Serve a static asset from within a network directory.
 * The `network` query parameter must be the same absolute directory path
 * used to load the network. The asset path is restricted to within that
 * directory to prevent traversal attacks.
 *
 * Query parameters:
 *   network – absolute path to the network directory
 */
networkRoutes.get("/assets/*", async (c) => {
  const networkId = c.req.query("network");
  const networkDir = resolveNetworkPath(networkId);
  if (!networkDir) {
    return c.json({ error: "Missing query parameter: network" }, 400);
  }

  const assetPath = c.req.path.replace(/^\/api\/network\/assets\//, "");
  if (!assetPath) {
    return c.json({ error: "Missing asset path" }, 400);
  }

  const fullPath = normalize(resolve(join(networkDir, assetPath)));
  if (!fullPath.startsWith(normalize(networkDir))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    return c.json({ error: "Asset not found" }, 404);
  }

  return new Response(file, {
    headers: { "Content-Type": file.type },
  });
});

networkRoutes.get("/", async (c) => {
  const networkId = c.req.query("network");
  const networkDir = resolveNetworkPath(networkId);
  if (!networkDir) {
    return c.json({ error: "Missing query parameter: network" }, 400);
  }

  try {
    const result = await loadNetwork(networkDir);
    return c.json(result);
  } catch (err) {
    return c.json(
      {
        error: "Failed to load network",
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

