import { barkConfigSchema, barkTestPushResponseSchema, updateBarkConfigSchema } from "@workplan/contracts";
import type { FastifyInstance } from "fastify";
import { invalidInput } from "../errors.js";
import type { BarkConfigService } from "../modules/bark-config.js";

// Bark 配置 API（R2）：仅 Administrator 读写；PUT 用 contracts schema 校验 URL。
// 与 env-config 路由相同模式：route schema 负责文档，handler 内用 zod 重新解析。
export async function registerBarkSettingsRoutes(app: FastifyInstance, barkConfig: BarkConfigService) {
  app.get(
    "/api/v1/settings/bark",
    {
      schema: { response: { 200: barkConfigSchema } },
      config: { authorization: "admin" },
    },
    async () => barkConfig.get(),
  );

  app.put(
    "/api/v1/settings/bark",
    {
      schema: { body: updateBarkConfigSchema, response: { 200: barkConfigSchema } },
      config: { authorization: "admin" },
    },
    async (request) => {
      const parsed = updateBarkConfigSchema.safeParse(request.body);
      if (!parsed.success) throw invalidInput("Bark 配置无效：服务器 URL 必须是合法的 http(s) 地址");
      return barkConfig.save(parsed.data);
    },
  );

  app.post(
    "/api/v1/settings/bark/test",
    {
      schema: { response: { 200: barkTestPushResponseSchema } },
      config: { authorization: "admin" },
    },
    async () => barkConfig.sendTestPush(),
  );
}
