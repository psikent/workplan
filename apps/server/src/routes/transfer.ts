import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TransferService } from "../modules/transfer.js";

export async function registerTransferRoutes(app: FastifyInstance, transfer: TransferService) {
  app.get("/api/v1/export", { config: { authorization: "admin" } }, async (_request, reply) => {
    reply.header("Content-Disposition", `attachment; filename="workplan-${new Date().toISOString().slice(0, 10)}.json"`);
    return transfer.export();
  });

  app.post(
    "/api/v1/import/validate",
    { schema: { body: z.unknown() }, config: { authorization: "admin" } },
    async (request) => transfer.validate(request.body),
  );

  app.post(
    "/api/v1/import",
    { schema: { body: z.unknown() }, config: { authorization: "admin" } },
    async (request) => transfer.import(request.body),
  );
}
