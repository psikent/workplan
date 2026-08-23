import type { FastifyInstance } from "fastify";
import { createMonthlyGoalSeriesSchema, updateMonthlyGoalSeriesSchema } from "@workplan/contracts";
import { z } from "zod";
import type { MonthlyGoalSeriesService } from "../modules/monthly-goal-series.js";

const idParams = z.object({ id: z.string().uuid() });

export async function registerMonthlyGoalSeriesRoutes(app: FastifyInstance, series: MonthlyGoalSeriesService) {
  app.get("/api/v1/monthly-goal-series", async () => series.list());

  app.get(
    "/api/v1/monthly-goal-series/:id",
    { schema: { params: idParams } },
    async (request) => series.get((request.params as { id: string }).id),
  );

  app.post(
    "/api/v1/monthly-goal-series",
    { schema: { body: createMonthlyGoalSeriesSchema } },
    async (request, reply) => {
      const created = series.create(createMonthlyGoalSeriesSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/monthly-goal-series/:id",
    { schema: { params: idParams, body: updateMonthlyGoalSeriesSchema } },
    async (request) => series.update((request.params as { id: string }).id, updateMonthlyGoalSeriesSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/monthly-goal-series/:id",
    { schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      series.stop((request.params as { id: string }).id, (request.query as { version: number }).version);
      reply.code(204).send();
    },
  );
}
