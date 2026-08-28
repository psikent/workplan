import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Formal systemd topology: these values are fixed by the ADR and are not
// overridable through the command line.
export const systemdHost = "127.0.0.1";
export const systemdPort = "3000";

export function createRandomSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

export function parseEnv(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  }
  return entries;
}

export function serializeEnv(entries) {
  const preferredOrder = [
    "NODE_ENV",
    "HOST",
    "PORT",
    "DATA_DIR",
    "APP_SECRET",
    "APP_BASE_URL",
    "TZ",
    "SESSION_DAYS",
  ];
  const keys = [
    ...preferredOrder.filter((key) => entries.has(key)),
    ...[...entries.keys()].filter((key) => !preferredOrder.includes(key)).sort(),
  ];
  return `${keys.map((key) => `${key}=${quoteEnvValue(entries.get(key) ?? "")}`).join("\n")}\n`;
}

function quoteEnvValue(value) {
  if (/^[A-Za-z0-9_./:\\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

export function normalizeProductionEnv(existing, createSecret) {
  const entries = new Map(existing);
  entries.set("NODE_ENV", "production");
  entries.set("HOST", entries.get("HOST") || "0.0.0.0");
  entries.set("PORT", entries.get("PORT") || "3000");
  entries.set("DATA_DIR", "./data");
  entries.set("TZ", entries.get("TZ") || "Asia/Shanghai");
  entries.set("SESSION_DAYS", entries.get("SESSION_DAYS") || "30");

  const oldBaseUrl = entries.get("APP_BASE_URL");
  if (!oldBaseUrl) {
    entries.set("APP_BASE_URL", `http://localhost:${entries.get("PORT")}`);
  }

  const secret = entries.get("APP_SECRET") ?? "";
  if (secret.length < 32 || secret.startsWith("replace-with-")) entries.set("APP_SECRET", createSecret());
  return entries;
}

export function normalizeSystemdEnv(existing, createSecret = createRandomSecret) {
  const entries = new Map(existing);
  entries.set("NODE_ENV", "production");
  // Systemd mode fixes the loopback host and the formal port while preserving
  // every unrelated entry and a valid secret.
  entries.set("HOST", systemdHost);
  entries.set("PORT", systemdPort);
  entries.set("DATA_DIR", entries.get("DATA_DIR") || "./data");
  entries.set("TZ", entries.get("TZ") || "Asia/Shanghai");
  entries.set("SESSION_DAYS", entries.get("SESSION_DAYS") || "30");
  if (!entries.has("APP_BASE_URL")) {
    entries.set("APP_BASE_URL", `http://${systemdHost}:${systemdPort}`);
  }

  const secret = entries.get("APP_SECRET") ?? "";
  if (secret.length < 32 || secret.startsWith("replace-with-")) entries.set("APP_SECRET", createSecret());
  return entries;
}

export function resolveRuntimeDataDir(runtimeRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(runtimeRoot, value);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readTail(filePath, lines = 100) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).slice(-lines).join("\n").trimEnd();
}
