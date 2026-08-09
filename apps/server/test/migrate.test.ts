import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";

describe("database migrations", () => {
  it("preserves version-4 administrators and tokens while applying later migrations", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (4, 'unify_export_template_field_names', '2026-08-08T17:27:32.098Z');
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users(id, username, password_hash, created_at) VALUES ('user-1', 'lxj', 'argon-hash', '2026-08-08T05:53:04.073Z');
      INSERT INTO access_tokens(id, user_id, name, token_hash, created_at, version) VALUES ('token-1', 'user-1', '测试', 'sha256-hash', '2026-08-09T03:56:06.507Z', 1);
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 6 });
    expect(database.prepare("SELECT id, username, role, login_mode AS loginMode, disabled_at AS disabledAt, version FROM users").get()).toEqual({
      id: "user-1",
      username: "lxj",
      role: "admin",
      loginMode: "password",
      disabledAt: null,
      version: 1,
    });
    expect(database.prepare("SELECT id, user_id AS userId, name, version FROM access_tokens").get()).toEqual({ id: "token-1", userId: "user-1", name: "测试", version: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM owner_account_mappings").get()).toEqual({ count: 9 });
    expect(database.prepare("SELECT account FROM owner_account_mappings WHERE owner_name = '冯铭倩'").get()).toEqual({ account: "fengmingqian@zh.gd.csg.cn" });
    database.close();
  });

  it("adds the owner account mappings to a version-5 database without changing existing business rows", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (5, 'user_roles_and_login_modes', '2026-08-09T04:40:05.266Z');
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE export_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO work_plans(id, title) VALUES ('plan-1', '保留计划');
      INSERT INTO export_templates(id, name) VALUES ('template-1', '保留模板');
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 6 });
    expect(database.prepare("SELECT id, title FROM work_plans").get()).toEqual({ id: "plan-1", title: "保留计划" });
    expect(database.prepare("SELECT id, name FROM export_templates").get()).toEqual({ id: "template-1", name: "保留模板" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM owner_account_mappings").get()).toEqual({ count: 9 });
    expect(() => database.prepare("INSERT INTO owner_account_mappings(owner_name, account) VALUES (?, ?)").run("重复账号", "fengmingqian@zh.gd.csg.cn")).toThrow();
    database.close();
  });

  it("seeds all owner account mappings in a fresh database", () => {
    const database = new Database(":memory:");
    migrate(database);

    expect(database.prepare("SELECT COUNT(*) AS count FROM owner_account_mappings").get()).toEqual({ count: 9 });
    expect(database.prepare("SELECT owner_name AS ownerName, account FROM owner_account_mappings ORDER BY owner_name").all()).toContainEqual({
      ownerName: "罗智凌",
      account: "luozhiling@zh.gd.csg.cn",
    });
    database.close();
  });
});
