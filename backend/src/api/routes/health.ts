import { Router, Request, Response } from "express";
import { getConfig } from "../../config";

const router = Router();

let startTime = Date.now();

router.get("/", (_req: Request, res: Response) => {
  const config = getConfig();
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: config.NPM_PACKAGE_VERSION,
    stellarNetwork: config.STELLAR_NETWORK,
  });
});

router.get("/deep", async (_req: Request, res: Response) => {
  const config = getConfig();
  const horizonUrl = config.STELLAR_HORIZON_URL;

  const [veniceStatus, horizonStatus] = await Promise.all([
    checkVenice(config.VENICE_API_KEY),
    checkHorizon(horizonUrl),
  ]);

  res.json({
    venice: veniceStatus,
    horizon: horizonStatus,
  });
});

async function checkVenice(apiKey: string): Promise<"ok" | "unreachable"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://api.venice.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkHorizon(url: string): Promise<"ok" | "unreachable"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export { router as healthRouter };
