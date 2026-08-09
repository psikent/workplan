import { createHash, randomBytes, randomUUID } from "node:crypto";

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
