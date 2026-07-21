import express, { Request, Response, NextFunction } from "express";
import { createServer, Server as HttpServer } from "http";
import { randomUUID } from "crypto";
import swaggerUi from "swagger-ui-express";

import {
  type DispatchFn,
  type PaymentReleaseFn,
} from "../coordinator/coordinator";
import { getTask } from "../coordinator/taskStore";
import { eventBus } from "../coordinator/eventBus";
import { createEventStore, type EventStore } from "../coordinator/eventStore";
import { attachTaskStream, type TaskStreamOptions } from "./routes/stream";
import {
  createPaymentReleaseFn,
  type StellarReleasePaymentFn,
} from "../payment";
import { agentsRouter } from "./routes/agents";
import { healthRouter } from "./routes/health";
import { createStatsRouter } from "./routes/stats";
import { createTasksRouter } from "./routes/tasks";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { authMiddleware } from "./middleware/auth";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { createLogger } from "../utils/logger";
import { createTaskDb, getTaskDb } from "../db/tasks";
import { openapiSpec } from "./docs/openapi";

export interface AppOptions {
  /** Called to execute a single DAG node; defaults to HTTP dispatch */
  dispatch?: DispatchFn;
  /** Called after each node completes; defaults to no-op (returns 'mock-hash') */
  releasePayment?: PaymentReleaseFn;
  /** Event log for stream replay; defaults to an in-memory SQLite store */
  eventStore?: EventStore;
  /** Heartbeat / auth timing for the WebSocket stream */
  stream?: TaskStreamOptions;
}

/**
 * Attempt to load smart-contracts releasePayment at runtime via dynamic require.
 * Returns undefined when the module is unavailable (e.g. backend CI without
 * smart-contracts compiled). Using require() instead of a static import keeps
 * TypeScript's rootDir constraint intact.
 */
function tryLoadStellarRelease(): StellarReleasePaymentFn | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../../smart-contracts/src/payment/payment")
      .releasePayment as StellarReleasePaymentFn;
  } catch {
    return undefined;
  }
}

export function createApp(opts: AppOptions = {}): {
  httpServer: HttpServer;
  close: (callback?: () => void) => void;
} {
  const app = express();
  app.use(express.json());
  // ── Global middleware ────────────────────────────────────────────────────────
  app.use(requestId);
  app.use(requestLogger);

  const dispatch: DispatchFn = opts.dispatch ?? defaultDispatch;
  const releasePayment: PaymentReleaseFn =
    opts.releasePayment ?? createPaymentReleaseFn(tryLoadStellarRelease());

  // ── Health routes ───────────────────────────────────────────────────────────
  app.use("/health", healthRouter);

  // ── Stats routes ───────────────────────────────────────────────────────────
  app.use("/api/stats", createStatsRouter(getTaskDb()));

  // ── Agent routes ───────────────────────────────────────────────────────────
  app.use("/api/agents", agentsRouter);

  // ── API docs ─────────────────────────────────────────────────────────────────
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(openapiSpec);
  });

  // ── Task routes ────────────────────────────────────────────────────────────
  app.use("/api/tasks", createTasksRouter(dispatch, releasePayment));

  // ── HTTP server ────────────────────────────────────────────────────────────
  const httpServer = createServer(app);

  // ── Event persistence ──────────────────────────────────────────────────────
  // Record every Coordinator event (with its EventBus-assigned per-task seq) so
  // a (re)connecting client can replay history before live streaming begins —
  // either the full history, or only events past a `?lastEventId` cursor.
  const eventStore = opts.eventStore ?? createEventStore();
  const stopRecording = eventBus.subscribeAll((event) =>
    eventStore.append(event),
  );

  // ── WebSocket: /tasks/:id/stream ───────────────────────────────────────────
  const detachStream = attachTaskStream({
    httpServer,
    eventStore,
    eventBus,
    getTask,
    ...opts.stream,
  });

  // ── Error handler (must be last) ───────────────────────────────────────────
  app.use(errorHandler);

  function close(callback?: () => void): void {
    detachStream();
    stopRecording();
    eventStore.close();
    httpServer.close(callback);
  }

  return { httpServer, close };
}

async function defaultDispatch(
  taskId: string,
  node: { nodeId: string; agentType: string; prompt: string },
  context: string,
): Promise<unknown> {
  // In production this POSTs to the agent's HTTP endpoint.
  // The e2e test replaces this via opts.dispatch.
  throw new Error(`No agent registered for type: ${node.type}`);
}
