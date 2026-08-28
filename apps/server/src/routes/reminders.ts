import type { FastifyInstance } from "fastify";
import { listRemindersQuerySchema } from "@workplan/contracts";
import { invalidInput } from "../errors.js";
import type { ReminderService } from "../modules/reminders.js";

// NOTE: 不在路由 schema 传 querystring —— fastify 的 AJV（coerceTypes +
// removeAdditional）会在 handler 前改写 request.query，破坏下面的 zod 解析
// （与 monthly-goals / custom-fields 路由相同的模式）。
export async function registerReminderRoutes(app: FastifyInstance, reminders: ReminderService) {
  app.get("/api/v1/reminders", async (request) => {
    const parsed = listRemindersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidInput("查询参数无效");
    return reminders.derive(parsed.data.from, parsed.data.to);
  });
}
