import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, projectRoot } from "../src/config.js";

const originalCwd = process.cwd();
const originalDataDir = process.env.DATA_DIR;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.unstubAllEnvs();
});

describe("server configuration paths", () => {
  it("uses the repository data directory regardless of the current directory", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.DATA_DIR;

    const fromRoot = loadConfig();
    process.chdir(path.join(projectRoot, "apps/server"));
    const fromServer = loadConfig();
    process.chdir(path.parse(projectRoot).root);
    const fromElsewhere = loadConfig();

    const expected = path.join(projectRoot, "data");
    expect(fromRoot.dataDir).toBe(expected);
    expect(fromServer.dataDir).toBe(expected);
    expect(fromElsewhere.dataDir).toBe(expected);
  });

  it("resolves a relative DATA_DIR from the repository root", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATA_DIR", "runtime-data");
    expect(loadConfig().dataDir).toBe(path.join(projectRoot, "runtime-data"));
  });

  it("keeps absolute DATA_DIR values unchanged", () => {
    vi.stubEnv("NODE_ENV", "development");
    const absolute = path.resolve(projectRoot, "../external-workplan-data");
    vi.stubEnv("DATA_DIR", absolute);
    expect(loadConfig().dataDir).toBe(path.normalize(absolute));
  });

  it("requires a persistent secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "");
    expect(() => loadConfig()).toThrow("APP_SECRET must contain at least 32 characters");
  });
});
