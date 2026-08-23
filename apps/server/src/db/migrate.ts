import type Database from "better-sqlite3";

type Migration = { version: number; name: string; sql: string };

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_work_plan_schema",
    sql: `
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);
      CREATE TABLE access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

      CREATE TABLE work_plan_series (id TEXT PRIMARY KEY, template_json TEXT NOT NULL, frequency TEXT NOT NULL, interval INTEGER NOT NULL, weekdays_json TEXT, until_at TEXT, occurrence_count INTEGER, time_zone TEXT NOT NULL, generated_through TEXT, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE work_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, sort_order INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL, occurrence_key TEXT, is_exception INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(series_id, occurrence_key));
      CREATE INDEX work_plans_schedule_idx ON work_plans(start_at, end_at);
      CREATE INDEX work_plans_status_idx ON work_plans(status);
      CREATE INDEX work_plans_sort_idx ON work_plans(sort_order);

      CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0, default_value_json TEXT, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX custom_fields_sort_idx ON custom_field_definitions(sort_order);
      CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1, UNIQUE(field_id, value));
      CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, PRIMARY KEY(work_plan_id, field_id));
      CREATE INDEX custom_values_text_idx ON custom_field_values(field_id, text_value);
      CREATE INDEX custom_values_number_idx ON custom_field_values(field_id, number_value);
      CREATE INDEX custom_values_date_idx ON custom_field_values(field_id, date_value);
      CREATE INDEX custom_values_datetime_idx ON custom_field_values(field_id, datetime_value);
      CREATE TABLE custom_field_multi_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, option_id TEXT NOT NULL REFERENCES custom_field_options(id) ON DELETE CASCADE, PRIMARY KEY(work_plan_id, field_id, option_id));
      CREATE INDEX custom_multi_option_idx ON custom_field_multi_values(field_id, option_id);
    `,
  },
  {
    version: 2,
    name: "export_templates",
    sql: `
      CREATE TABLE export_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sheet_name TEXT NOT NULL,
        columns_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "automatic_work_plan_status",
    sql: `
      ALTER TABLE work_plans ADD COLUMN status_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(status_mode IN ('automatic', 'manual'));
      UPDATE work_plans SET status_mode = 'manual' WHERE status = 'cancelled';
    `,
  },
  {
    version: 4,
    name: "unify_export_template_field_names",
    sql: `
      UPDATE export_templates SET columns_json = (
        SELECT json_group_array(json_object(
          'source', json_extract(item.value, '$.source'),
          'header', CASE
            WHEN json_extract(item.value, '$.source') = 'title' AND json_extract(item.value, '$.header') = '标题' THEN '工作内容'
            WHEN json_extract(item.value, '$.source') = 'description' AND json_extract(item.value, '$.header') = '描述' THEN '说明'
            ELSE json_extract(item.value, '$.header')
          END
        ))
        FROM json_each(columns_json) AS item
      );
    `,
  },
  {
    version: 5,
    name: "user_roles_and_login_modes",
    sql: `
      ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'editor'));
      ALTER TABLE users ADD COLUMN login_mode TEXT NOT NULL DEFAULT 'password' CHECK(login_mode IN ('password', 'token'));
      ALTER TABLE users ADD COLUMN disabled_at TEXT;
      ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 6,
    name: "owner_account_mappings",
    sql: `
      CREATE TABLE owner_account_mappings (
        owner_name TEXT PRIMARY KEY,
        account TEXT NOT NULL UNIQUE
      );
      INSERT INTO owner_account_mappings(owner_name, account) VALUES
        ('曲资饶', 'quzirao@zh.gd.csg.cn'),
        ('翁凯鹏', 'wengkaipeng@zh.gd.csg.cn'),
        ('罗智凌', 'luozhiling@zh.gd.csg.cn'),
        ('高文琪', 'gaowenqi@zh.gd.csg.cn'),
        ('严嘉栋', 'yanjiadong@zh.gd.csg.cn'),
        ('刘溪桥', 'liuxiqiao@zh.gd.csg.cn'),
        ('冯铭倩', 'fengmingqian@zh.gd.csg.cn'),
        ('刘行健', 'liuxingjian@zh.gd.csg.cn'),
        ('吴亦鸣', 'wuyiming@zh.gd.csg.cn');
    `,
  },
  {
    version: 7,
    name: "monthly_goals",
    sql: `
      CREATE TABLE monthly_goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        work_plan_id TEXT REFERENCES work_plans(id) ON DELETE SET NULL,
        archived_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX monthly_goals_period_idx ON monthly_goals(year, month);
      CREATE INDEX monthly_goals_work_plan_idx ON monthly_goals(work_plan_id);
    `,
  },
  {
    version: 8,
    name: "monthly_goal_series",
    sql: `
      CREATE TABLE monthly_goal_series (
        id TEXT PRIMARY KEY,
        template_json TEXT NOT NULL,
        frequency TEXT NOT NULL,
        interval INTEGER NOT NULL DEFAULT 1,
        start_year INTEGER NOT NULL,
        start_month INTEGER NOT NULL,
        occurrence_count INTEGER,
        until_year INTEGER,
        until_month INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE monthly_goals ADD COLUMN series_id TEXT REFERENCES monthly_goal_series(id) ON DELETE SET NULL;
      ALTER TABLE monthly_goals ADD COLUMN occurrence_key TEXT;
      CREATE UNIQUE INDEX monthly_goal_series_occurrence_idx ON monthly_goals(series_id, occurrence_key);
    `,
  },
];

export function migrate(database: Database.Database): void {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const current = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  const apply = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (migration.version > current.version) apply(migration);
  }
}
