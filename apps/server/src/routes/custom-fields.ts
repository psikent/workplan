import type { FastifyInstance } from "fastify";
import {
  createCustomFieldOptionSchema,
  createCustomFieldSchema,
  updateCustomFieldOptionSchema,
  updateCustomFieldSchema,
} from "@workplan/contracts";
import { z } from "zod";
import type { CustomFieldService } from "../modules/custom-fields.js";

const idParams = z.object({ id: z.string().uuid() });

export async function registerCustomFieldRoutes(app: FastifyInstance, customFields: CustomFieldService) {
  app.get("/api/v1/custom-fields", async (request) => {
    const includeArchived = (request.query as { includeArchived?: string }).includeArchived === "true";
    return customFields.list(includeArchived);
  });

  app.post(
    "/api/v1/custom-fields",
    { schema: { body: createCustomFieldSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const created = customFields.create(createCustomFieldSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/custom-fields/:id",
    { schema: { params: idParams, body: updateCustomFieldSchema }, config: { authorization: "admin" } },
    async (request) => customFields.update((request.params as { id: string }).id, updateCustomFieldSchema.parse(request.body)),
  );

  app.post(
    "/api/v1/custom-fields/reorder",
    { schema: { body: z.object({ orderedIds: z.array(z.string().uuid()).min(1) }) }, config: { authorization: "admin" } },
    async (request) => {
      customFields.reorder((request.body as { orderedIds: string[] }).orderedIds);
      return customFields.list();
    },
  );

  app.post(
    "/api/v1/custom-fields/:id/options",
    { schema: { params: idParams, body: createCustomFieldOptionSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const option = customFields.addOption((request.params as { id: string }).id, createCustomFieldOptionSchema.parse(request.body));
      reply.code(201);
      return option;
    },
  );

  app.patch(
    "/api/v1/custom-field-options/:id",
    { schema: { params: idParams, body: updateCustomFieldOptionSchema }, config: { authorization: "admin" } },
    async (request) => customFields.updateOption((request.params as { id: string }).id, updateCustomFieldOptionSchema.parse(request.body)),
  );
}
