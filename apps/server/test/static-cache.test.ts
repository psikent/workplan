import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const contexts: { app: FastifyInstance; dir: string }[] = [];

afterEach(async () => {
  while (contexts.length) {
    const { app, dir } = contexts.pop()!;
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function createStaticApp() {
  const dir = mkdtempSync(join(tmpdir(), "workplan-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>工作计划</title>");
  writeFileSync(join(dir, "sw.js"), "// service worker");
  writeFileSync(join(dir, "manifest.webmanifest"), "{}");
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-tests",
      appSecret: "test-secret-with-at-least-thirty-two-characters",
      appBaseUrl: "http://localhost:3000",
      isProduction: false,
      webDistPath: dir,
    },
    startScheduler: false,
  });
  contexts.push({ app: built.app, dir });
  return built.app;
}

describe("static cache headers", () => {
  it("serves hashed assets with an immutable long cache", async () => {
    const app = await createStaticApp();
    const response = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("serves the service worker with must-revalidate", async () => {
    const app = await createStaticApp();
    const response = await app.inject({ method: "GET", url: "/sw.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("serves the manifest as no-cache with the manifest content type", async () => {
    const app = await createStaticApp();
    const response = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["content-type"]).toContain("application/manifest+json");
  });

  it("serves the entry document as no-cache", async () => {
    const app = await createStaticApp();
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("serves the SPA fallback as no-cache HTML", async () => {
    const app = await createStaticApp();
    const response = await app.inject({ method: "GET", url: "/work-plans" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });
});
