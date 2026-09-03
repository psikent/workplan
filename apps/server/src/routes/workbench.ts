import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkbenchService } from "../modules/workbench.js";

const overviewQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

export function registerWorkbenchRoutes(app: FastifyInstance, workbench: WorkbenchService) {
  app.get(
    "/api/v1/workbench/overview",
    { schema: { querystring: overviewQuery } },
    async (request) => workbench.overview((request.query as { limit?: number }) ?? {}),
  );
}
