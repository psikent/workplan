import {
  envConfigImportModeSchema,
  envConfigImportResultSchema,
  envConfigPackageSchema,
  envConfigPlanSchema,
  envConfigSections,
  envConfigSectionSchema,
} from "@workplan/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EnvConfigService } from "../modules/env-config.js";

const validateEnvConfigSchema = z.object({
  package: z.unknown(),
  mode: envConfigImportModeSchema.default("additive"),
  sections: z.array(envConfigSectionSchema).default([...envConfigSections]),
});

const importEnvConfigSchema = z.object({
  package: z.unknown(),
  mode: envConfigImportModeSchema,
  sections: z.array(envConfigSectionSchema),
  confirmDestructive: z.boolean(),
});

export async function registerEnvConfigRoutes(app: FastifyInstance, envConfig: EnvConfigService) {
  app.get(
    "/api/v1/env-config",
    {
      schema: { response: { 200: envConfigPackageSchema } },
      config: { authorization: "admin" },
    },
    async () => envConfig.exportPackage(),
  );

  app.get(
    "/api/v1/env-config/file",
    {
      schema: { response: { 200: envConfigPackageSchema } },
      config: { authorization: "admin" },
    },
    async (_request, reply) => {
      const date = new Date().toISOString().slice(0, 10);
      reply.header("Content-Disposition", `attachment; filename="env-config-${date}.json"`);
      return envConfig.exportPackage();
    },
  );

  app.post(
    "/api/v1/env-config/validate",
    {
      schema: {
        body: validateEnvConfigSchema,
        response: { 200: envConfigPlanSchema },
      },
      config: { authorization: "admin" },
    },
    async (request) => {
      const body = validateEnvConfigSchema.parse(request.body);
      return envConfig.validate(body.package, body.mode);
    },
  );

  app.post(
    "/api/v1/env-config/import",
    {
      schema: {
        body: importEnvConfigSchema,
        response: { 200: envConfigImportResultSchema },
      },
      config: { authorization: "admin" },
    },
    async (request) => {
      const body = importEnvConfigSchema.parse(request.body);
      if (body.mode === "additive") {
        return envConfig.importAdditive(body.package, body.sections);
      }
      return envConfig.importSync(body.package, {
        sections: body.sections,
        confirmDestructive: body.confirmDestructive,
      });
    },
  );
}
