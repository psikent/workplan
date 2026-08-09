import type { CreateOwnerAccountMapping, OwnerAccountMapping, UpdateOwnerAccountMapping } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { AppError, notFound } from "../errors.js";

type MappingRow = {
  owner_name: string;
  account: string;
};

type OwnerValueRow = {
  owner_value: string;
  account: string;
};

export class OwnerAccountService {
  constructor(private readonly database: DatabaseBundle) {}

  private serialize(row: MappingRow): OwnerAccountMapping {
    return { ownerName: row.owner_name, account: row.account };
  }

  private getRow(ownerName: string): MappingRow | undefined {
    return this.database.sqlite
      .prepare("SELECT owner_name, account FROM owner_account_mappings WHERE owner_name = ?")
      .get(ownerName) as MappingRow | undefined;
  }

  private rethrowConstraint(error: unknown): never {
    const detail = String(error);
    if (detail.includes("owner_account_mappings.account")) {
      throw new AppError(409, "OWNER_ACCOUNT_ALREADY_MAPPED", "该账号已经映射给其他工作负责人");
    }
    if (detail.includes("owner_account_mappings.owner_name")) {
      throw new AppError(409, "OWNER_NAME_ALREADY_MAPPED", "该工作负责人已经存在账号映射");
    }
    throw error;
  }

  list(): OwnerAccountMapping[] {
    return (this.database.sqlite
      .prepare("SELECT owner_name, account FROM owner_account_mappings ORDER BY owner_name")
      .all() as MappingRow[])
      .map((row) => this.serialize(row));
  }

  create(input: CreateOwnerAccountMapping): OwnerAccountMapping {
    try {
      this.database.sqlite
        .prepare("INSERT INTO owner_account_mappings(owner_name, account) VALUES (?, ?)")
        .run(input.ownerName, input.account);
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.serialize(this.getRow(input.ownerName)!);
  }

  update(currentOwnerName: string, input: UpdateOwnerAccountMapping): OwnerAccountMapping {
    if (!this.getRow(currentOwnerName)) throw notFound("负责人账号映射不存在");
    try {
      this.database.sqlite
        .prepare("UPDATE owner_account_mappings SET owner_name = ?, account = ? WHERE owner_name = ?")
        .run(input.ownerName, input.account, currentOwnerName);
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.serialize(this.getRow(input.ownerName)!);
  }

  delete(ownerName: string): void {
    const result = this.database.sqlite
      .prepare("DELETE FROM owner_account_mappings WHERE owner_name = ?")
      .run(ownerName);
    if (result.changes === 0) throw notFound("负责人账号映射不存在");
  }

  indexByOwnerValue(): ReadonlyMap<string, string> {
    const rows = this.database.sqlite.prepare(`
      SELECT option.value AS owner_value, mapping.account
      FROM custom_field_definitions AS field
      JOIN custom_field_options AS option ON option.field_id = field.id
      JOIN owner_account_mappings AS mapping ON mapping.owner_name = option.label
      WHERE field.key = 'owner'
    `).all() as OwnerValueRow[];
    return new Map(rows.map((row) => [row.owner_value, row.account]));
  }
}
