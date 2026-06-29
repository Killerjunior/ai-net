import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../../utils/logger";

const log = createLogger();

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  log.error(
    {
      error: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
      requestId: res.locals.requestId,
    },
    "unhandled error",
  );

  res.status(500).json({
    error: {
      message: err.message || "Internal server error",
      code: "INTERNAL_ERROR",
    },
  });
}
