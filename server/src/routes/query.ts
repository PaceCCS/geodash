import { Hono } from "hono";
import { queryNetwork } from "../services/core";
import { resolveNetworkPath } from "../utils/network";

export const queryRoutes = new Hono();

/**
 * GET /api/query
 *
 * Query the network using the path-based query language.
 *
 * Query parameters:
 *   q       – query path, e.g. "branch-4/blocks/0/pressure"
 *   network – network directory path (absolute or relative to CWD)
 *
 * Example:
 *   GET /api/query?network=/path/to/preset1&q=branch-4/blocks/0/pressure
 */
queryRoutes.get("/", async (c) => {
  const q = c.req.query("q");
  const networkId = c.req.query("network");

  if (!q) {
    return c.json({ error: "Missing query parameter: q" }, 400);
  }

  const networkDir = resolveNetworkPath(networkId);
  if (!networkDir) {
    return c.json({ error: "Missing query parameter: network" }, 400);
  }

  try {
    const result = await queryNetwork(networkDir, q);
    return c.json(result);
  } catch (err) {
    return c.json(
      {
        error: "Query failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});
