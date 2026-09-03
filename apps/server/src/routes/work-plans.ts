import type { FastifyInstance } from "fastify";
import {
  createWorkPlanSchema,
  listWorkPlansQuerySchema,
  searchWorkPlansSchema,
  updateScheduleSchema,
  updateWorkPlanSchema,
  workPlanQueryRequestSchema,
} from "@workplan/contracts";
import { z } from "zod";
import type { WorkPlanService } from "../modules/work-plans.js";
import { invalidInput, reorderRetired } from "../errors.js";

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

  // 重排墓碑（票据 14）：无副作用，返回 410 与稳定错误类别。
  // 结构化日志只含时间、请求 id 与路由标识，不记录认证凭据或请求正文；
  // 14 天零调用观察按 `event":"work_plan_reorder_tombstone"` 计数。
  app.post(
    "/api/v1/work-plans/reorder",
    { config: { authorization: "write" } },
    async (request) => {
      request.log.info({ event: "work_plan_reorder_tombstone", route: "/api/v1/work-plans/reorder" }, "工作计划重排已退役");
      throw reorderRetired();
    },
  );
}
