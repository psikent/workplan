import type { FastifyInstance } from "fastify";
import { createMonthlyGoalSchema, updateMonthlyGoalSchema } from "@workplan/contracts";
import { z } from "zod";
import { invalidInput } from "../errors.js";
import type { MonthlyGoalService } from "../modules/monthly-goals.js";

const idParams = z.object({ id: z.string().uuid() });

// NOTE: no schema on the route — fastify's AJV (coerceTypes + removeAdditional)
// rewrites request.query before the handler (e.g. "true" -> boolean, unknown
// keys stripped), which would break the zod parse below. Mirror the custom-fields
// route and validate the raw string query in the handler instead.
const listMonthlyGoalsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  includeArchived: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});

const deleteMonthlyGoalQuerySchema = z.object({ version: z.coerce.number().int().positive() });

export async function registerMonthlyGoalRoutes(app: FastifyInstance, monthlyGoals: MonthlyGoalService) {
  app.get("/api/v1/monthly-goals", async (request) => {
    const parsed = listMonthlyGoalsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidInput("查询参数无效");
    return monthlyGoals.list(parsed.data);
  });

  app.get(
    "/api/v1/monthly-goals/:id",
    { schema: { params: idParams } },
    async (request) => monthlyGoals.get((request.params as { id: string }).id),
  );

  app.post(
    "/api/v1/monthly-goals",
    { schema: { body: createMonthlyGoalSchema } },
    async (request, reply) => {
      const created = monthlyGoals.create(createMonthlyGoalSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/monthly-goals/:id",
    { schema: { params: idParams, body: updateMonthlyGoalSchema } },
    async (request) => monthlyGoals.update((request.params as { id: string }).id, updateMonthlyGoalSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/monthly-goals/:id",
    { schema: { params: idParams, querystring: deleteMonthlyGoalQuerySchema } },
    async (request, reply) => {
      monthlyGoals.delete((request.params as { id: string }).id, (request.query as { version: number }).version);
      reply.code(204).send();
    },
  );
}
