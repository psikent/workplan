import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loadConfig, type AppConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { AppError } from "./errors.js";
import { AuthService } from "./modules/auth.js";
import { CustomFieldService } from "./modules/custom-fields.js";
import { OwnerAccountService } from "./modules/owner-accounts.js";
import { RecurrenceService } from "./modules/recurrence.js";
import { TransferService } from "./modules/transfer.js";
import { SpreadsheetTransferService } from "./modules/spreadsheet-transfer.js";
import { WorkPlanService } from "./modules/work-plans.js";
import { registerAuthRoutes, cookieName } from "./routes/auth.js";
import { registerCustomFieldRoutes } from "./routes/custom-fields.js";
import { registerOwnerAccountRoutes } from "./routes/owner-accounts.js";
import { registerRecurrenceRoutes } from "./routes/recurrence.js";
import { registerTransferRoutes } from "./routes/transfer.js";
import { registerSpreadsheetTransferRoutes } from "./routes/spreadsheet-transfer.js";
import { registerWorkPlanRoutes } from "./routes/work-plans.js";
import "./types.js";

const developmentWebOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

function isPrivateNetworkHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addressType = net.isIP(host);
  if (addressType === 4) {
    const [first, second] = host.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second! >= 64 && second! <= 127)
    );
  }
  if (addressType === 6) {
    const normalized = host.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  }
  return false;
}

function isPrivateNetworkOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

export type BuildAppOptions = {
  config?: Partial<AppConfig>;
  logger?: boolean;
  startScheduler?: boolean;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const config = loadConfig(options.config);
  const trustedOrigins = new Set([new URL(config.appBaseUrl).origin]);
  if (!config.isProduction) {
    developmentWebOrigins.forEach((origin) => trustedOrigins.add(origin));
  }
  const database = openDatabase(config.databasePath);
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("auth", null);

  await app.register(cookie, { secret: config.appSecret, hook: "onRequest" });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: "工作计划 API", version: "1.0.0" },
      servers: [{ url: config.appBaseUrl }],
      components: {
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: cookieName },
          bearerToken: { type: "http", scheme: "bearer" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  const auth = new AuthService(database, config);
  const customFields = new CustomFieldService(database);
  const ownerAccounts = new OwnerAccountService(database);
  const workPlans = new WorkPlanService(database, customFields, ownerAccounts);
  const recurrence = new RecurrenceService(database, workPlans);
  const transfer = new TransferService(database);
  const spreadsheetTransfer = new SpreadsheetTransferService(database, customFields, workPlans);

  const publicApiPaths = new Set([
    "/api/v1/setup/status",
    "/api/v1/setup",
    "/api/v1/auth/login",
  ]);

  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/") || publicApiPaths.has(request.url.split("?")[0]!)) return;
    const authorization = request.headers.authorization;
    let context = authorization?.startsWith("Bearer ") ? auth.authenticateAccessToken(authorization.slice(7)) : null;
    if (!context) {
      const signedCookie = request.cookies[cookieName];
      if (signedCookie) {
        const unsigned = request.unsignCookie(signedCookie);
        if (unsigned.valid && unsigned.value) context = auth.authenticateSession(unsigned.value);
      }
    }
    if (!context) throw new AppError(401, "AUTHENTICATION_REQUIRED", "请先登录");
    request.auth = context;

    if (request.routeOptions.config.authorization === "admin" && context.role !== "admin") {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "当前账户没有执行此操作的权限");
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && context.kind === "session") {
      if (request.headers["x-csrf-token"] !== context.csrfToken) {
        throw new AppError(403, "CSRF_TOKEN_INVALID", "CSRF 令牌无效");
      }
      const origin = request.headers.origin;
      const trustedPrivateNetworkOrigin = origin ? isPrivateNetworkOrigin(origin) : false;
      if (origin && !trustedOrigins.has(origin) && !trustedPrivateNetworkOrigin) {
        throw new AppError(403, "ORIGIN_NOT_ALLOWED", "请求来源不受信任");
      }
    }
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    database.sqlite.prepare("SELECT 1").get();
    return { status: "ready", database: "ok" };
  });

  await registerAuthRoutes(app, auth);
  await registerWorkPlanRoutes(app, workPlans);
  await registerCustomFieldRoutes(app, customFields);
  await registerOwnerAccountRoutes(app, ownerAccounts);
  await registerRecurrenceRoutes(app, recurrence);
  await registerTransferRoutes(app, transfer);
  await registerSpreadsheetTransferRoutes(app, spreadsheetTransfer);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.status).send({
        type: `https://workplan.local/problems/${error.code.toLocaleLowerCase()}`,
        title: error.code,
        status: error.status,
        code: error.code,
        detail: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
      });
      return;
    }
    const validation = error as { validation?: Array<{ instancePath?: string; message?: string }>; statusCode?: number };
    if (validation.validation) {
      reply.code(422).send({
        type: "https://workplan.local/problems/validation-error",
        title: "VALIDATION_ERROR",
        status: 422,
        code: "VALIDATION_ERROR",
        detail: validation.validation.map((item) => `${item.instancePath ?? ""} ${item.message ?? ""}`.trim()).join("；"),
      });
      return;
    }
    app.log.error(error);
    reply.code(500).send({
      type: "https://workplan.local/problems/internal-error",
      title: "INTERNAL_ERROR",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "服务端发生未预期错误",
    });
  });

  let scheduler: NodeJS.Timeout | undefined;
  if (options.startScheduler !== false) {
    const tick = () => {
      try {
        recurrence.ensureAllGenerated();
        auth.cleanupExpired();
      } catch (error) {
        app.log.error(error, "scheduler tick failed");
      }
    };
    tick();
    scheduler = setInterval(tick, 60_000);
    scheduler.unref();
  }

  if (auth.isSetupRequired()) {
    app.log.warn({ setupToken: auth.setupToken, expiresAt: auth.setupExpiresAt }, "one-time setup token");
  }

  if (fs.existsSync(config.webDistPath)) {
    await app.register(fastifyStatic, { root: config.webDistPath, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/health/")) {
        reply.code(404).send({
          type: "https://workplan.local/problems/not-found",
          title: "NOT_FOUND",
          status: 404,
          code: "NOT_FOUND",
          detail: "接口不存在",
        });
        return;
      }
      reply.type("text/html").send(fs.createReadStream(path.join(config.webDistPath, "index.html")));
    });
  }

  app.addHook("onClose", async () => {
    if (scheduler) clearInterval(scheduler);
    database.sqlite.close();
  });

  return { app, config, services: { auth, customFields, workPlans, recurrence, transfer, spreadsheetTransfer }, database };
}
