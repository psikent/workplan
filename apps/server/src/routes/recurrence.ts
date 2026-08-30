import type { FastifyInstance } from "fastify";
import { attachRecurringRuleSchema, createWorkPlanSeriesSchema, updateWorkPlanSeriesSchema } from "@workplan/contracts";
import { z } from "zod";
import type { RecurrenceService } from "../modules/recurrence.js";

const idParams = z.object({ id: z.string().uuid() });

export async function registerRecurrenceRoutes(app: FastifyInstance, recurrence: RecurrenceService) {
  app.get("/api/v1/work-plan-series", async () => recurrence.list());

  app.post(
    "/api/v1/work-plan-series",
    { schema: { body: createWorkPlanSeriesSchema }, config: { authorization: "write" } },
    async (request, reply) => {
      const body = createWorkPlanSeriesSchema.parse(request.body);
      const result = recurrence.create(body.workPlan, body.recurrence);
      reply.code(201);
      return result;
    },
  );

  app.post(
    "/api/v1/work-plans/:id/series",
    { schema: { params: idParams, body: attachRecurringRuleSchema }, config: { authorization: "write" } },
    async (request, reply) => {
      const body = attachRecurringRuleSchema.parse(request.body);
      const result = recurrence.createFromExisting((request.params as { id: string }).id, body.workPlan, body.recurrence, body.version);
      reply.code(201);
      return result;
    },
  );

  app.patch(
    "/api/v1/work-plan-series/:id",
    { schema: { params: idParams, body: updateWorkPlanSeriesSchema }, config: { authorization: "write" } },
    async (request) => recurrence.update((request.params as { id: string }).id, updateWorkPlanSeriesSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/work-plan-series/:id",
    { schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) }, config: { authorization: "write" } },
    async (request) => recurrence.stop((request.params as { id: string }).id, (request.query as { version: number }).version),
  );
}
