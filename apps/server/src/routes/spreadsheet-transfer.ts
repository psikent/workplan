import type { FastifyInstance } from "fastify";
import {
  createExportTemplateSchema,
  exportWorkPlansXlsSchema,
  importWorkPlansXlsSchema,
  updateExportTemplateSchema,
  workPlanStatusSchema,
} from "@workplan/contracts";
import { parseWorkPlanSortParam } from "@workplan/contracts";
import { z } from "zod";
import type { SpreadsheetTransferService } from "../modules/spreadsheet-transfer.js";

const idParams = z.object({ id: z.string().uuid() });
const exportQuerySchema = z.object({
  templateId: z.string().uuid(),
  q: z.string().max(200).optional(),
  status: workPlanStatusSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.string().max(700).optional(),
});

export async function registerSpreadsheetTransferRoutes(app: FastifyInstance, spreadsheetTransfer: SpreadsheetTransferService) {
  app.get("/api/v1/export-templates", async () => spreadsheetTransfer.listTemplates());

  app.post(
    "/api/v1/export-templates",
    { schema: { body: createExportTemplateSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const created = spreadsheetTransfer.createTemplate(createExportTemplateSchema.parse(request.body));
      reply.code(201);
      return created;
    },
  );

  app.patch(
    "/api/v1/export-templates/:id",
    { schema: { params: idParams, body: updateExportTemplateSchema }, config: { authorization: "admin" } },
    async (request) => spreadsheetTransfer.updateTemplate((request.params as { id: string }).id, updateExportTemplateSchema.parse(request.body)),
  );

  app.delete(
    "/api/v1/export-templates/:id",
    {
      schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) },
      config: { authorization: "admin" },
    },
    async (request, reply) => {
      spreadsheetTransfer.deleteTemplate((request.params as { id: string }).id, (request.query as { version: number }).version);
      reply.code(204).send();
    },
  );

  app.get(
    "/api/v1/work-plans/export.xls",
    { schema: { querystring: exportQuerySchema } },
    async (request, reply) => {
      const query = exportQuerySchema.parse(request.query);
      const result = spreadsheetTransfer.exportXls(query.templateId, {
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.sort ? { sort: parseWorkPlanSortParam(query.sort) ?? [] } : {}),
      });
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      return reply.send(result.data);
    },
  );

  app.post(
    "/api/v1/work-plans/export.xls",
    { schema: { body: exportWorkPlansXlsSchema } },
    async (request, reply) => {
      const body = exportWorkPlansXlsSchema.parse(request.body);
      const query = body.query ?? {
        ...(body.q ? { q: body.q } : {}),
        filters: body.status ? [{ field: "status", op: "eq", value: body.status }] : [],
        range: { ...(body.from ? { from: body.from } : {}), ...(body.to ? { to: body.to } : {}) },
        sort: [],
      };
      const result = spreadsheetTransfer.exportXlsCustom(
        { columns: body.columns, sheetName: body.sheetName, ...(body.name ? { name: body.name } : {}) },
        query,
      );
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      return reply.send(result.data);
    },
  );

  app.post(
    "/api/v1/work-plans/import.xls",
    { schema: { body: importWorkPlansXlsSchema }, config: { authorization: "admin" } },
    async (request) => {
      const body = importWorkPlansXlsSchema.parse(request.body);
      return spreadsheetTransfer.importXls(body.templateId, Buffer.from(body.dataBase64, "base64"));
    },
  );
}
