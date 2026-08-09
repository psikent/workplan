import type { FastifyInstance } from "fastify";
import {
  createWorkPlanSchema,
  listWorkPlansQuerySchema,
  reorderWorkPlansSchema,
  searchWorkPlansSchema,
  updateScheduleSchema,
  updateWorkPlanSchema,
} from "@workplan/contracts";
import { z } from "zod";
import type { WorkPlanService } from "../modules/work-plans.js";

const idParams = z.object({ id: z.string().uuid() });

export async function registerWorkPlanRoutes(app: FastifyInstance, workPlans: WorkPlanService) {
  app.get(
    "/api/v1/work-plans",
    { schema: { querystring: listWorkPlansQuerySchema } },
    async (request) => workPlans.list(listWorkPlansQuerySchema.parse(request.query)),
  );

  app.post(
    "/api/v1/work-plans/search",
    { schema: { body: searchWorkPlansSchema } },
    async (request) => workPlans.search(searchWorkPlansSchema.parse(request.body)),
  );

  app.get(
    "/api/v1/work-plans/:id",
    { schema: { params: idParams } },
    async (request) => workPlans.get((request.params as { id: string }).id),
  );

  app.post(
    "/api/v1/work-plans",
    { schema: { body: createWorkPlanSchema } },
    async (request, reply) => {
      const created = workPlans.create(createWorkPlanSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/work-plans/:id",
    { schema: { params: idParams, body: updateWorkPlanSchema } },
    async (request) => workPlans.update((request.params as { id: string }).id, updateWorkPlanSchema.parse(request.body)),
  );

  app.patch(
    "/api/v1/work-plans/:id/schedule",
    { schema: { params: idParams, body: updateScheduleSchema } },
    async (request) => workPlans.updateSchedule((request.params as { id: string }).id, updateScheduleSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/work-plans/:id",
    { schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      workPlans.delete((request.params as { id: string }).id, (request.query as { version: number }).version);
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/work-plans/reorder",
    { schema: { body: reorderWorkPlansSchema } },
    async (request) => workPlans.reorder(reorderWorkPlansSchema.parse(request.body).orderedIds),
  );
}
