import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

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
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
  const appSecret =
    overrides.appSecret ??
    process.env.APP_SECRET ??
    (isProduction ? "" : "development-only-secret-change-me-123456789");

  if (appSecret.length < 32) {
    throw new Error("APP_SECRET must contain at least 32 characters");
  }

  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.PORT ?? 3000),
    dataDir,
    databasePath: overrides.databasePath ?? path.join(dataDir, "workplan.db"),
    appSecret,
    appBaseUrl: overrides.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000",
    timeZone: overrides.timeZone ?? process.env.TZ ?? "Asia/Shanghai",
    sessionDays: overrides.sessionDays ?? Number(process.env.SESSION_DAYS ?? 30),
    isProduction: overrides.isProduction ?? isProduction,
    webDistPath: overrides.webDistPath ?? process.env.WEB_DIST_PATH ?? path.resolve(serverDir, "../../web/dist"),
  };
}
