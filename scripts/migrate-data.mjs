import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.resolve(sourceRoot, "../workplan-release");
const requireFromServer = createRequire(path.join(sourceRoot, "apps/server/package.json"));
const Database = requireFromServer("better-sqlite3");
const sourcePath = path.join(sourceRoot, "apps/server/data/workplan.db");
const destinations = [
  { name: "开发", path: path.join(sourceRoot, "data/workplan.db") },
  { name: "正式", path: path.join(releaseRoot, "data/workplan.db") },
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
const countTables = ["users", "work_plans", "custom_field_definitions", "work_plan_series", "export_templates"];

function assertInside(filePath, root) {
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`路径超出允许范围：${filePath}`);
}

function counts(database) {
  const result = {};
  for (const table of countTables) result[table] = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return result;
}

async function backupDatabase(database, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await database.backup(destination);
}

async function migrateDestination(source, destination) {
  const root = path.dirname(path.dirname(destination.path));
  assertInside(destination.path, root);
  const dataDir = path.dirname(destination.path);
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  if (fs.existsSync(destination.path)) {
    const existing = new Database(destination.path, { readonly: true });
    const backupPath = path.join(backupDir, `pre-node-only-${stamp}.db`);
    await backupDatabase(existing, backupPath);
    existing.close();
    console.log(`${destination.name}旧数据库已备份：${backupPath}`);
  }

  const tempPath = path.join(dataDir, `.workplan-migration-${process.pid}.db`);
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${tempPath}${suffix}`, { force: true });
  await backupDatabase(source, tempPath);
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${destination.path}${suffix}`, { force: true });
  fs.rmSync(destination.path, { force: true });
  fs.renameSync(tempPath, destination.path);

  const migrated = new Database(destination.path, { readonly: true });
  const result = counts(migrated);
  migrated.close();
  return result;
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`源数据库不存在：${sourcePath}`);
  const source = new Database(sourcePath, { readonly: true });
  const expected = counts(source);
  const sourceBackup = path.join(path.dirname(sourcePath), "backups", `pre-root-migration-${stamp}.db`);
  await backupDatabase(source, sourceBackup);
  console.log(`源数据库已备份：${sourceBackup}`);
  console.log(`源数据库计数：${JSON.stringify(expected)}`);

  for (const destination of destinations) {
    const actual = await migrateDestination(source, destination);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${destination.name}数据库迁移校验失败：${JSON.stringify(actual)}`);
    }
    console.log(`${destination.name}数据库迁移完成：${destination.path} ${JSON.stringify(actual)}`);
  }
  source.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
