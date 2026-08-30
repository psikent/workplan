import type { AuthContext } from "./modules/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }

  interface FastifyContextConfig {
    authorization?: "write" | "admin";
  }
}
