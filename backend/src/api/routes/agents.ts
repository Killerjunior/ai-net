import { Router, Request, Response } from "express";
import { z } from "zod";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { getAgentDb, createAgentDb, AgentDb } from "../../db/agents";

export interface AgentsRouterOptions {
  healthTimeoutMs?: number;
  db?: AgentDb;
}

const RegisterAgentSchema = z.object({
  agentId: z.string(),
  capabilities: z.array(z.string()),
  pricingXLM: z.number(),
  endpoint: z.string().url(),
  stellarPublicKey: z.string()
});

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const horizon = new Horizon.Server(HORIZON_URL);

export function createAgentsRouter(options: AgentsRouterOptions = {}): Router {
  const router = Router();
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

  const getDb = () => options.db ?? createAgentDb(getAgentDb());

  // GET /api/agents
  router.get("/", (req: Request, res: Response): void => {
    const db = getDb();
    const capability = req.query.capability as string | undefined;
    const minReputation = req.query.minReputation ? parseFloat(req.query.minReputation as string) : undefined;
    const maxPriceXLM = req.query.maxPriceXLM ? parseFloat(req.query.maxPriceXLM as string) : undefined;
    
    try {
      const agents = db.list({ capability, minReputation, maxPriceXLM });
      res.json(agents);
    } catch (err) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // GET /api/agents/:id
  router.get("/:id", (req: Request, res: Response): void => {
    const db = getDb();
    const agent = db.findById(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(agent);
  });

  // GET /api/agents/:id/health
  router.get("/:id/health", async (req: Request, res: Response): Promise<void> => {
    const db = getDb();
    const agent = db.findById(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), healthTimeoutMs);

    try {
      const response = await fetch(agent.endpoint, {
        method: "GET",
        signal: controller.signal,
      });

      res.status(200).json({
        status: response.ok ? "healthy" : "unreachable",
        latencyMs: Date.now() - startedAt,
      });
    } catch {
      res.status(200).json({
        status: "unreachable",
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  // POST /api/agents/register
  router.post("/register", async (req: Request, res: Response): Promise<void> => {
    const parse = RegisterAgentSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.flatten() });
      return;
    }
    
    const data = parse.data;
    
    // Verify Stellar account exists
    if (process.env.SKIP_STELLAR_ACCOUNT_VERIFY !== "true") {
      try {
        await horizon.loadAccount(data.stellarPublicKey);
      } catch (err: any) {
        if (err?.response?.status === 404) {
          res.status(400).json({ error: "StellarAccountNotFound" });
          return;
        }
        if (process.env.NODE_ENV !== "test") {
          res.status(400).json({ error: "Failed to verify Stellar account", details: err.message });
          return;
        }
      }
    }
    
    const db = getDb();
    const agent = {
      id: data.agentId,
      capabilities: data.capabilities,
      pricingXLM: data.pricingXLM,
      endpoint: data.endpoint,
      stellarPublicKey: data.stellarPublicKey,
      reputationScore: 0,
      lastSeenAt: new Date().toISOString()
    };
    
    db.upsert(agent);
    
    res.status(201).json(agent);
  });

  // DELETE /api/agents/:id
  router.delete("/:id", (req: Request, res: Response): void => {
    const db = getDb();
    const agent = db.findById(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    
    const signature = req.headers["x-signature"] as string;
    const challenge = req.headers["x-challenge"] as string;
    
    if (!signature || !challenge) {
      res.status(401).json({ error: "Missing challenge or signature" });
      return;
    }
    
    try {
      const keypair = Keypair.fromPublicKey(agent.stellarPublicKey);
      const isValid = keypair.verify(Buffer.from(challenge), Buffer.from(signature, "base64"));
      if (!isValid) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } catch (err) {
      res.status(401).json({ error: "Invalid signature format" });
      return;
    }
    
    db.delete(req.params.id);
    res.json({ message: "Agent deleted successfully" });
  });

  return router;
}

export const agentsRouter = createAgentsRouter();
