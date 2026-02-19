import { Hono } from "hono";
import { loadNetwork } from "../services/core";
import { resolveNetworkPath } from "../utils/network";

export const networkRoutes = new Hono();

/**
 * GET /api/network
 *
 * Load a network and return its node/edge structure.
 *
 * Query parameters:
 *   network – network directory path (absolute or relative to CWD)
 */
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

