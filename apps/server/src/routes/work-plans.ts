import type { FastifyInstance } from "fastify";
import {
  createWorkPlanSchema,
  listWorkPlansQuerySchema,
  reorderWorkPlansSchema,
  searchWorkPlansSchema,
  updateScheduleSchema,
  updateWorkPlanSchema,
  workPlanQueryRequestSchema,
} from "@workplan/contracts";
import { z } from "zod";
import type { WorkPlanService } from "../modules/work-plans.js";
import { invalidInput } from "../errors.js";

const idParams = z.object({ id: z.string().uuid() });

export async function registerWorkPlanRoutes(app: FastifyInstance, workPlans: WorkPlanService) {
  app.get(
    "/api/v1/work-plans",
    { schema: { querystring: listWorkPlansQuerySchema } },
    async (request) => workPlans.list(listWorkPlansQuerySchema.parse(request.query)),
  );

  app.post(
    "/api/v1/work-plans/query",
    { schema: { body: workPlanQueryRequestSchema } },
    async (request) => {
      // 统一查询仅支持游标分页；显式携带 offset 的请求直接拒绝（稳定 422）。
      if (request.body && typeof request.body === "object" && "offset" in (request.body as Record<string, unknown>)) {
        throw invalidInput("统一查询使用游标分页，不支持 offset 参数");
      }
      return workPlans.query(workPlanQueryRequestSchema.parse(request.body));
    },
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
    { schema: { body: createWorkPlanSchema }, config: { authorization: "write" } },
    async (request, reply) => {
      const created = workPlans.create(createWorkPlanSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/work-plans/:id",
    { schema: { params: idParams, body: updateWorkPlanSchema }, config: { authorization: "write" } },
    async (request) => workPlans.update((request.params as { id: string }).id, updateWorkPlanSchema.parse(request.body)),
  );

  app.patch(
    "/api/v1/work-plans/:id/schedule",
    { schema: { params: idParams, body: updateScheduleSchema }, config: { authorization: "write" } },
    async (request) => workPlans.updateSchedule((request.params as { id: string }).id, updateScheduleSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/work-plans/:id",
    { schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) }, config: { authorization: "write" } },
    async (request, reply) => {
      workPlans.delete((request.params as { id: string }).id, (request.query as { version: number }).version);
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/work-plans/reorder",
    { schema: { body: reorderWorkPlansSchema }, config: { authorization: "write" } },
    async (request) => workPlans.reorder(reorderWorkPlansSchema.parse(request.body).orderedIds),
  );
}
