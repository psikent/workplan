import type { FastifyInstance, FastifyReply } from "fastify";
import { createAccessTokenSchema, createManagedUserSchema, loginSchema, setManagedUserPasswordSchema, setupSchema, updateUserStatusSchema } from "@workplan/contracts";
import { z } from "zod";
import type { AuthService } from "../modules/auth.js";

const cookieName = "workplan_session";
const idParams = z.object({ id: z.string().uuid() });
const userTokenParams = z.object({ userId: z.string().uuid(), tokenId: z.string().uuid() });

export async function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.get("/api/v1/setup/status", async () => ({
    setupRequired: auth.isSetupRequired(),
    setupTokenExpiresAt: auth.isSetupRequired() ? auth.setupExpiresAt : null,
  }));

  app.post(
    "/api/v1/setup",
    { schema: { body: setupSchema }, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = setupSchema.parse(request.body);
      await auth.setup(body.token, body.username, body.password);
      const loggedIn = await auth.login(body.username, body.password);
      setSessionCookie(reply, loggedIn.token, loggedIn.expiresAt, request.protocol === "https");
      return { user: loggedIn.user, csrfToken: loggedIn.csrfToken };
    },
  );

  app.post(
    "/api/v1/auth/login",
    { schema: { body: loginSchema }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const result = await auth.login(body.username, body.password);
      setSessionCookie(reply, result.token, result.expiresAt, request.protocol === "https");
      return { user: result.user, csrfToken: result.csrfToken };
    },
  );

  app.get("/api/v1/auth/me", async (request) => ({
    user: auth.getUser(request.auth!.userId),
    csrfToken: request.auth?.kind === "session" ? request.auth.csrfToken : null,
    authKind: request.auth!.kind,
  }));

  app.post("/api/v1/auth/logout", async (request, reply) => {
    auth.logout(request.auth?.sessionId);
    reply.clearCookie(cookieName, { path: "/" });
    return { loggedOut: true };
  });

  app.get("/api/v1/tokens", { config: { authorization: "admin" } }, async (request) => auth.listTokens(request.auth!.userId));

  app.get("/api/v1/users", { config: { authorization: "admin" } }, async () => auth.listUsers());

  app.post(
    "/api/v1/users",
    { schema: { body: createManagedUserSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const body = createManagedUserSchema.parse(request.body);
      const created = body.loginMode === "password"
        ? await auth.createPasswordUser({ username: body.username, role: body.role, password: body.password })
        : await auth.createTokenOnlyUser({
            username: body.username,
            role: body.role,
            tokenName: body.tokenName,
            tokenExpiresAt: body.tokenExpiresAt,
          });
      reply.code(201);
      return created;
    },
  );

  app.put(
    "/api/v1/users/:id/password",
    { schema: { params: idParams, body: setManagedUserPasswordSchema }, config: { authorization: "admin" } },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = setManagedUserPasswordSchema.parse(request.body);
      return auth.setUserPassword(id, body.password, body.version);
    },
  );

  app.post(
    "/api/v1/tokens",
    { schema: { body: createAccessTokenSchema }, config: { authorization: "admin" } },
    async (request) => {
      const body = createAccessTokenSchema.parse(request.body);
      return auth.createAccessToken(request.auth!.userId, body.name, body.expiresAt);
    },
  );

  app.post(
    "/api/v1/users/:id/tokens",
    { schema: { params: idParams, body: createAccessTokenSchema }, config: { authorization: "admin" } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = createAccessTokenSchema.parse(request.body);
      const token = auth.createAccessTokenForUser(id, body.name, body.expiresAt);
      reply.code(201);
      return token;
    },
  );

  app.patch(
    "/api/v1/users/:id",
    { schema: { params: idParams, body: updateUserStatusSchema }, config: { authorization: "admin" } },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateUserStatusSchema.parse(request.body);
      return auth.setUserDisabled(id, body.disabled, body.version);
    },
  );

  app.delete(
    "/api/v1/users/:id",
    {
      schema: { params: idParams, querystring: z.object({ version: z.coerce.number().int().positive() }) },
      config: { authorization: "admin" },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { version } = request.query as { version: number };
      auth.deleteManagedUser(id, version, request.auth!.userId);
      return { deleted: true };
    },
  );

  app.delete(
    "/api/v1/users/:userId/tokens/:tokenId",
    {
      schema: { params: userTokenParams, querystring: z.object({ version: z.coerce.number().int().positive() }) },
      config: { authorization: "admin" },
    },
    async (request) => {
      const { userId, tokenId } = request.params as { userId: string; tokenId: string };
      const { version } = request.query as { version: number };
      auth.revokeAccessTokenForUser(userId, tokenId, version);
      return { revoked: true };
    },
  );

  app.delete(
    "/api/v1/tokens/:id",
    {
      schema: { params: z.object({ id: z.string().uuid() }), querystring: z.object({ version: z.coerce.number().int().positive() }) },
      config: { authorization: "admin" },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { version } = request.query as { version: number };
      auth.revokeAccessToken(request.auth!.userId, id, version);
      return { revoked: true };
    },
  );
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, secure: boolean) {
  reply.setCookie(cookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    signed: true,
    expires: new Date(expiresAt),
  });
}

export { cookieName };
