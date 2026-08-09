import type { FastifyInstance } from "fastify";
import { createOwnerAccountMappingSchema, updateOwnerAccountMappingSchema } from "@workplan/contracts";
import { z } from "zod";
import type { OwnerAccountService } from "../modules/owner-accounts.js";

const ownerNameParams = z.object({ ownerName: z.string().trim().min(1).max(80) });

export async function registerOwnerAccountRoutes(app: FastifyInstance, ownerAccounts: OwnerAccountService) {
  app.get("/api/v1/owner-account-mappings", async () => ownerAccounts.list());

  app.post(
    "/api/v1/owner-account-mappings",
    { schema: { body: createOwnerAccountMappingSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const created = ownerAccounts.create(createOwnerAccountMappingSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.put(
    "/api/v1/owner-account-mappings/:ownerName",
    {
      schema: { params: ownerNameParams, body: updateOwnerAccountMappingSchema },
      config: { authorization: "admin" },
    },
    async (request) => ownerAccounts.update(
      (request.params as { ownerName: string }).ownerName,
      updateOwnerAccountMappingSchema.parse(request.body),
    ),
  );

  app.delete(
    "/api/v1/owner-account-mappings/:ownerName",
    { schema: { params: ownerNameParams }, config: { authorization: "admin" } },
    async (request, reply) => {
      ownerAccounts.delete((request.params as { ownerName: string }).ownerName);
      reply.code(204).send();
    },
  );
}
