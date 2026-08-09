import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";

export type DatabaseBundle = ReturnType<typeof openDatabase>;

export function openDatabase(databasePath: string) {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (databasePath !== ":memory:") sqlite.pragma("journal_mode = WAL");
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
