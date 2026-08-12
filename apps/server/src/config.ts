import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDir, "../../..");

function resolveFromProjectRoot(value: string) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  appSecret: string;
  appBaseUrl: string;
  timeZone: string;
  sessionDays: number;
  isProduction: boolean;
  webDistPath: string;
};

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const dataDir = resolveFromProjectRoot(overrides.dataDir ?? process.env.DATA_DIR ?? "data");
  const appSecret =
    overrides.appSecret ??
    process.env.APP_SECRET ??
    (isProduction ? "" : "development-only-secret-change-me-123456789");

  if (appSecret.length < 32) {
    throw new Error("APP_SECRET must contain at least 32 characters");
  }

  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.PORT ?? (isProduction ? 3000 : 3002)),
    dataDir,
    databasePath: overrides.databasePath ?? path.join(dataDir, "workplan.db"),
    appSecret,
    appBaseUrl: overrides.appBaseUrl ?? process.env.APP_BASE_URL ?? `http://localhost:${isProduction ? 3000 : 3002}`,
    timeZone: overrides.timeZone ?? process.env.TZ ?? "Asia/Shanghai",
    sessionDays: overrides.sessionDays ?? Number(process.env.SESSION_DAYS ?? 30),
    isProduction: overrides.isProduction ?? isProduction,
    webDistPath: overrides.webDistPath ?? path.join(projectRoot, "apps/web/dist"),
  };
}
