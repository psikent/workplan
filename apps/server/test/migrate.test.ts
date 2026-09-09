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
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, sort_order INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status_mode TEXT NOT NULL DEFAULT 'automatic');
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'short_text');
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users(id, username, password_hash, created_at) VALUES ('user-1', 'lxj', 'argon-hash', '2026-08-08T05:53:04.073Z');
      INSERT INTO access_tokens(id, user_id, name, token_hash, created_at, version) VALUES ('token-1', 'user-1', '测试', 'sha256-hash', '2026-08-09T03:56:06.507Z', 1);
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
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
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'editor')), login_mode TEXT NOT NULL DEFAULT 'password' CHECK(login_mode IN ('password', 'token')), disabled_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', status_mode TEXT NOT NULL DEFAULT 'automatic', priority TEXT NOT NULL DEFAULT 'none', start_at TEXT NOT NULL DEFAULT '', end_at TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'short_text');
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL, field_id TEXT NOT NULL, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE export_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO users(id, username, password_hash, role, created_at) VALUES ('user-1', 'lxj', 'argon-hash', 'admin', '2026-08-09T04:40:05.266Z');
      INSERT INTO work_plans(id, title) VALUES ('plan-1', '保留计划');
      INSERT INTO export_templates(id, name) VALUES ('template-1', '保留模板');
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    expect(database.prepare("SELECT id, title FROM work_plans").get()).toEqual({ id: "plan-1", title: "保留计划" });
    expect(database.prepare("SELECT id, name FROM export_templates").get()).toEqual({ id: "template-1", name: "保留模板" });
    expect(database.prepare("SELECT id, username, role FROM users").get()).toEqual({ id: "user-1", username: "lxj", role: "admin" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM owner_account_mappings").get()).toEqual({ count: 9 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM monthly_goals").get()).toEqual({ count: 0 });
    expect(() => database.prepare("INSERT INTO owner_account_mappings(owner_name, account) VALUES (?, ?)").run("重复账号", "fengmingqian@zh.gd.csg.cn")).toThrow();
    database.close();
  });

  it("preserves administrators, editors, sessions and tokens when rebuilding auth tables for viewer", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (8, 'monthly_goal_series', '2026-08-26T00:00:00.000Z');
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'editor')), login_mode TEXT NOT NULL DEFAULT 'password' CHECK(login_mode IN ('password', 'token')), disabled_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', status_mode TEXT NOT NULL DEFAULT 'automatic', priority TEXT NOT NULL DEFAULT 'none', start_at TEXT NOT NULL DEFAULT '', end_at TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'short_text');
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL, field_id TEXT NOT NULL, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users(id, username, password_hash, role, login_mode, disabled_at, version, created_at) VALUES
        ('user-admin', 'lxj', 'argon-admin-hash', 'admin', 'password', NULL, 3, '2026-08-08T05:53:04.073Z'),
        ('user-editor', 'editor-1', 'argon-editor-hash', 'editor', 'password', NULL, 2, '2026-08-10T08:00:00.000Z');
      INSERT INTO sessions(id, user_id, token_hash, csrf_token, expires_at, created_at) VALUES
        ('session-1', 'user-editor', 'session-hash-1', 'csrf-1', '2027-01-01T00:00:00.000Z', '2026-08-10T08:00:00.000Z');
      INSERT INTO access_tokens(id, user_id, name, token_hash, expires_at, last_used_at, created_at, version) VALUES
        ('token-1', 'user-editor', '导出用', 'token-hash-1', '2027-06-30T00:00:00.000Z', '2026-08-11T02:00:00.000Z', '2026-08-10T08:00:00.000Z', 1);
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    expect(database.prepare("SELECT id, username, password_hash AS passwordHash, role, login_mode AS loginMode, disabled_at AS disabledAt, version, created_at AS createdAt FROM users ORDER BY created_at").all()).toEqual([
      { id: "user-admin", username: "lxj", passwordHash: "argon-admin-hash", role: "admin", loginMode: "password", disabledAt: null, version: 3, createdAt: "2026-08-08T05:53:04.073Z" },
      { id: "user-editor", username: "editor-1", passwordHash: "argon-editor-hash", role: "editor", loginMode: "password", disabledAt: null, version: 2, createdAt: "2026-08-10T08:00:00.000Z" },
    ]);
    expect(database.prepare("SELECT id, user_id AS userId, token_hash AS tokenHash, csrf_token AS csrfToken, expires_at AS expiresAt, created_at AS createdAt FROM sessions").all()).toEqual([
      { id: "session-1", userId: "user-editor", tokenHash: "session-hash-1", csrfToken: "csrf-1", expiresAt: "2027-01-01T00:00:00.000Z", createdAt: "2026-08-10T08:00:00.000Z" },
    ]);
    expect(database.prepare("SELECT id, user_id AS userId, name, token_hash AS tokenHash, expires_at AS expiresAt, last_used_at AS lastUsedAt, created_at AS createdAt, version FROM access_tokens").all()).toEqual([
      { id: "token-1", userId: "user-editor", name: "导出用", tokenHash: "token-hash-1", expiresAt: "2027-06-30T00:00:00.000Z", lastUsedAt: "2026-08-11T02:00:00.000Z", createdAt: "2026-08-10T08:00:00.000Z", version: 1 },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM sessions JOIN users ON users.id = sessions.user_id").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM access_tokens JOIN users ON users.id = access_tokens.user_id").get()).toEqual({ count: 1 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("foreign_keys", { simple: true })).toEqual(1);

    database
      .prepare("INSERT INTO users(id, username, password_hash, role, login_mode, disabled_at, version, created_at) VALUES ('user-viewer', 'viewer-1', 'argon-viewer-hash', 'viewer', 'token', NULL, 1, '2026-08-26T00:00:00.000Z')")
      .run();
    expect(database.prepare("SELECT role, login_mode AS loginMode FROM users WHERE id = 'user-viewer'").get()).toEqual({ role: "viewer", loginMode: "token" });
    expect(() =>
      database
        .prepare("INSERT INTO users(id, username, password_hash, role, login_mode, disabled_at, version, created_at) VALUES ('user-bad', 'bad-1', 'argon-hash', 'guest', 'password', NULL, 1, '2026-08-26T00:00:00.000Z')")
        .run(),
    ).toThrow();

    database.prepare("DELETE FROM users WHERE id = 'user-viewer'").run();
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 2 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
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

  it("is not blocked by pre-existing dangling references in tables outside the auth rebuild", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (8, 'monthly_goal_series', '2026-08-26T00:00:00.000Z');
      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', status_mode TEXT NOT NULL DEFAULT 'automatic', priority TEXT NOT NULL DEFAULT 'none', start_at TEXT NOT NULL DEFAULT '', end_at TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'short_text');
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'editor')), login_mode TEXT NOT NULL DEFAULT 'password' CHECK(login_mode IN ('password', 'token')), disabled_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users(id, username, password_hash, role, created_at) VALUES ('user-1', 'lxj', 'hash', 'admin', '2026-08-08T05:53:04.073Z');
    `);
    // better-sqlite3 默认开启外键：模拟历史脏数据需临时关闭 FK 检查（老库的真实来源）。
    database.pragma("foreign_keys = OFF");
    database
      .prepare("INSERT INTO custom_field_values(work_plan_id, field_id, text_value) VALUES ('deleted-plan', 'field-1', '遗留值'), ('deleted-plan', 'field-2', '遗留值')")
      .run();
    database.pragma("foreign_keys = ON");

    // 迁移 9 只校验它重建的 auth 三表；custom_field_values 的历史悬挂引用不阻断升级。
    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM custom_field_values").get()).toEqual({ count: 2 });
    expect(database.pragma("foreign_key_check(users)")).toEqual([]);
    expect(database.pragma("foreign_key_check(sessions)")).toEqual([]);
    expect(database.pragma("foreign_key_check(access_tokens)")).toEqual([]);
    database.close();
  });

  it("creates the bark tables and stays idempotent on repeated runs", () => {
    const database = new Database(":memory:");
    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 14").get()).toEqual({ count: 1 });

    // 空库迁移后即可写入单行配置；第二次 migrate 不重跑、不报错。
    database
      .prepare("INSERT INTO bark_config(id, server_url, device_key, updated_at) VALUES (1, 'https://api.day.app', NULL, '2026-08-30T00:00:00.000Z')")
      .run();
    migrate(database);
    expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 14").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT id, server_url AS serverUrl, device_key AS deviceKey FROM bark_config").get()).toEqual({
      id: 1,
      serverUrl: "https://api.day.app",
      deviceKey: null,
    });

    // 单行约束：id 只能为 1。
    expect(() => database.prepare("INSERT INTO bark_config(id, server_url, device_key, updated_at) VALUES (2, 'https://api.day.app', NULL, '2026-08-30T00:00:00.000Z')").run()).toThrow();
    database.close();
  });

  it("rejects duplicate bark push logs for the same (push_date, reminder_type, plan_id)", () => {
    const database = new Database(":memory:");
    migrate(database);

    const insert = database.prepare("INSERT INTO bark_push_log(push_date, reminder_type, plan_id, pushed_at) VALUES (?, 'work-order', ?, ?)");
    insert.run("2026-08-30", "plan-1", "2026-08-30T01:30:00.000Z");
    // 同日同类型同计划重复推送 → 唯一索引冲突。
    expect(() => insert.run("2026-08-30", "plan-1", "2026-08-30T09:30:00.000Z")).toThrow();
    // 不同日期或不同计划不受影响。
    insert.run("2026-08-31", "plan-1", "2026-08-31T01:30:00.000Z");
    insert.run("2026-08-30", "plan-2", "2026-08-30T02:00:00.000Z");
    expect(database.prepare("SELECT COUNT(*) AS count FROM bark_push_log").get()).toEqual({ count: 3 });
    database.close();
  });

  it("adds custom_field_options.color in a fresh database and leaves existing rows null after upgrade", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (15, 'custom_field_definitions_collapsed', '2026-09-09T00:00:00.000Z');
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'single_select');
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO custom_field_definitions(id) VALUES ('field-1');
      INSERT INTO custom_field_options(id, field_id, value, label, sort_order, version) VALUES
        ('option-1', 'field-1', 'duty', '1.值班', 0, 1),
        ('option-2', 'field-1', 'automation', '4.自动化', 1, 1);
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    const columns = (database.prepare("PRAGMA table_info(custom_field_options)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toContain("color");
    // 存量数据不回填：升级后 color 全 NULL，由管理员在设置页配色。
    expect(database.prepare("SELECT id, color FROM custom_field_options ORDER BY sort_order").all()).toEqual([
      { id: "option-1", color: null },
      { id: "option-2", color: null },
    ]);
    database
      .prepare("INSERT INTO custom_field_options(id, field_id, value, label, color, sort_order, version) VALUES ('option-3', 'field-1', 'network', '5.网络安全', '#3b82f6', 2, 1)")
      .run();
    expect(database.prepare("SELECT color FROM custom_field_options WHERE id = 'option-3'").get()).toEqual({ color: "#3b82f6" });
    database.close();
  });

  it("drops work_plans.sort_order and its index while preserving rows, children and constraints", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (12, 'drop_stored_status_order_indexes', '2026-09-03T00:00:00.000Z');
      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, status_mode TEXT NOT NULL DEFAULT 'automatic', priority TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, sort_order INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, title_sort_key TEXT);
      CREATE UNIQUE INDEX work_plans_occurrence_uq ON work_plans(series_id, occurrence_key);
      CREATE INDEX work_plans_sort_idx ON work_plans(sort_order);
      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'short_text');
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, text_sort_key TEXT, datetime_sort_key TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE monthly_goals (id TEXT PRIMARY KEY, work_plan_id TEXT REFERENCES work_plans(id) ON DELETE SET NULL);
      INSERT INTO work_plan_series(id) VALUES ('series-1');
      INSERT INTO custom_field_definitions(id) VALUES ('field-1');
      INSERT INTO work_plans(id, title, description, status, status_mode, priority, start_at, end_at, sort_order, version, series_id, occurrence_key, is_exception, created_at, updated_at, title_sort_key) VALUES
        ('plan-1', '巡检计划', '带系列', 'pending', 'automatic', 'none', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z', 42, 3, 'series-1', 'occ-1', 1, '2026-08-30T00:00:00.000Z', '2026-08-31T00:00:00.000Z', '巡检计划'),
        ('plan-2', '独立计划', '', 'in_progress', 'manual', 'legacy', '2026-09-02T01:00:00.000Z', '2026-09-02T02:00:00.000Z', -7, 1, NULL, NULL, 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '独立计划');
      INSERT INTO custom_field_values(work_plan_id, field_id, text_value) VALUES ('plan-1', 'field-1', '高');
      INSERT INTO monthly_goals(id, work_plan_id) VALUES ('goal-1', 'plan-1');
    `);

    migrate(database);

    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });
    const columns = (database.prepare("PRAGMA table_info(work_plans)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).not.toContain("sort_order");
    expect(columns).toEqual(["id", "title", "description", "status", "status_mode", "priority", "start_at", "end_at", "version", "series_id", "occurrence_key", "is_exception", "created_at", "updated_at", "title_sort_key"]);
    const indexes = (database.prepare("PRAGMA index_list(work_plans)").all() as Array<{ name: string }>).map((index) => index.name);
    // 完整清单：v11 的 14 个索引原样重建（work_plans_sort_idx 除外）+ 主键与
    // UNIQUE(series_id, occurrence_key) 的两个自动索引。
    expect(indexes.sort()).toEqual([
      "idx_work_plans_created_asc",
      "idx_work_plans_created_desc",
      "idx_work_plans_duration_asc",
      "idx_work_plans_duration_desc",
      "idx_work_plans_end_asc",
      "idx_work_plans_end_desc",
      "idx_work_plans_schedule_full",
      "idx_work_plans_start_desc",
      "idx_work_plans_title_key_asc",
      "idx_work_plans_title_key_desc",
      "idx_work_plans_updated_asc",
      "idx_work_plans_updated_desc",
      "sqlite_autoindex_work_plans_1",
      "sqlite_autoindex_work_plans_2",
      "work_plans_schedule_idx",
      "work_plans_status_idx",
    ]);

    // 业务数据逐列保留；遗留 sort_order 数值不迁移、不映射。
    expect(database.prepare("SELECT id, title, status, status_mode, priority, version, series_id, occurrence_key, is_exception, title_sort_key FROM work_plans ORDER BY id").all()).toEqual([
      { id: "plan-1", title: "巡检计划", status: "pending", status_mode: "automatic", priority: "none", version: 3, series_id: "series-1", occurrence_key: "occ-1", is_exception: 1, title_sort_key: "巡检计划" },
      { id: "plan-2", title: "独立计划", status: "in_progress", status_mode: "manual", priority: "legacy", version: 1, series_id: null, occurrence_key: null, is_exception: 0, title_sort_key: "独立计划" },
    ]);

    // 子表数据完好：级联清空与 SET NULL 都没有发生。
    expect(database.prepare("SELECT work_plan_id, field_id, text_value FROM custom_field_values").all()).toEqual([{ work_plan_id: "plan-1", field_id: "field-1", text_value: "高" }]);
    expect(database.prepare("SELECT id, work_plan_id FROM monthly_goals").all()).toEqual([{ id: "goal-1", work_plan_id: "plan-1" }]);
    expect(database.pragma("foreign_key_check(work_plans)")).toEqual([]);

    // 唯一约束保留；新写入路径（无 sort_order 列）可用。
    expect(() =>
      database
        .prepare("INSERT INTO work_plans(id, title, status, status_mode, priority, start_at, end_at, created_at, updated_at, series_id, occurrence_key) VALUES ('plan-3', '撞键计划', 'pending', 'automatic', 'none', '2026-09-03T01:00:00.000Z', '2026-09-03T02:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 'series-1', 'occ-9')")
        .run(),
    ).not.toThrow();
    expect(() =>
      database
        .prepare("INSERT INTO work_plans(id, title, status, status_mode, priority, start_at, end_at, created_at, updated_at, series_id, occurrence_key) VALUES ('plan-3b', '撞键计划', 'pending', 'automatic', 'none', '2026-09-03T01:00:00.000Z', '2026-09-03T02:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 'series-1', 'occ-9')")
        .run(),
    ).toThrow();
    database
      .prepare("INSERT INTO work_plans(id, title, status, status_mode, priority, start_at, end_at, created_at, updated_at) VALUES ('plan-4', '新增计划', 'pending', 'automatic', 'none', '2026-09-04T01:00:00.000Z', '2026-09-04T02:00:00.000Z', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')")
      .run();
    database.close();
  });
});
