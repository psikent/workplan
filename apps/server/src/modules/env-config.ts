import type {
  CustomFieldDefinition,
  EnvConfigAction,
  EnvConfigFieldPlanItem,
  EnvConfigImportMode,
  EnvConfigImportOutcome,
  EnvConfigImportResult,
  EnvConfigMappingPlanItem,
  EnvConfigOptionAction,
  EnvConfigOptionPlanItem,
  EnvConfigPackage,
  EnvConfigPlan,
  EnvConfigSection,
  EnvConfigSkipReason,
  EnvConfigTemplatePlanItem,
} from "@workplan/contracts";
import { envConfigSections, parseEnvConfigPackage } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput } from "../errors.js";
import { nowIso } from "../utils.js";
import type { CustomFieldService } from "./custom-fields.js";
import type { OwnerAccountService } from "./owner-accounts.js";
import type { SpreadsheetTransferService } from "./spreadsheet-transfer.js";

type PackageField = EnvConfigPackage["customFields"][number];
type PackageMapping = EnvConfigPackage["ownerAccountMappings"][number];
type PackageTemplate = EnvConfigPackage["exportTemplates"][number];

type CountRow = { count: number };

export class EnvConfigService {
  constructor(
    private readonly database: DatabaseBundle,
    private readonly customFields: CustomFieldService,
    private readonly ownerAccounts: OwnerAccountService,
    private readonly spreadsheetTransfer: SpreadsheetTransferService,
  ) {}

  /** 导出当前环境的活动定义（无本地 id），用于复制或下载。 */
  exportPackage(): EnvConfigPackage {
    return {
      schemaVersion: 2,
      exportedAt: nowIso(),
      customFields: this.customFields.list(false).map((field) => ({
        key: field.key,
        label: field.label,
        description: field.description,
        type: field.type,
        required: field.required,
        defaultValue: field.defaultValue,
        options: field.options
          .filter((option) => !option.archivedAt)
          .map((option) => ({ value: option.value, label: option.label })),
        sortOrder: field.sortOrder,
      })),
      ownerAccountMappings: this.ownerAccounts.list(),
      exportTemplates: this.spreadsheetTransfer.listTemplates(false).map((template) => ({
        name: template.name,
        sheetName: template.sheetName,
        columns: template.columns,
      })),
    };
  }

  validate(payload: unknown, mode: EnvConfigImportMode): EnvConfigPlan {
    const pkg = this.parsePackage(payload);
    if (mode === "sync") {
      // 校验预览按全部区段都会导入来解析模板字段引用（R3/R5）。
      return this.planSync(pkg, [...envConfigSections]);
    }
    // 校验预览按全部区段都会导入来解析模板字段引用（R4）。
    return this.buildPlan(pkg, "additive", true);
  }

  /** 同步导入预览：按稳定身份对本地状态做差异计划，供校验与执行共用（R5）。 */
  planSync(pkg: EnvConfigPackage, sections: EnvConfigSection[]): EnvConfigPlan {
    return this.buildSyncPlan(pkg, new Set<EnvConfigSection>(sections));
  }

  /**
   * 同步导入：把目标环境收敛到与包一致（R5）。
   * 计划含破坏性变更且未确认时整体拒绝；执行在一个事务内按字段 → 选项 → 映射 → 模板顺序进行。
   */
  importSync(payload: unknown, options: { sections: EnvConfigSection[]; confirmDestructive: boolean }): EnvConfigImportResult {
    const selected = new Set<EnvConfigSection>(options.sections);
    const pkg = this.parsePackage(payload);
    const plan = this.buildSyncPlan(pkg, selected);
    const destructiveInSelection = [...selected].some((section) => this.sectionHasDestructive(plan, section));
    if (destructiveInSelection && !options.confirmDestructive) {
      throw invalidInput("同步导入包含破坏性变更，需确认破坏性操作后才能执行");
    }
    const execute = this.database.sqlite.transaction(() => {
      if (selected.has("customFields")) this.executeSyncFields(pkg, plan);
      if (selected.has("ownerAccountMappings")) this.executeSyncMappings(plan);
      if (selected.has("exportTemplates")) this.executeSyncTemplates(pkg, plan);
    });
    execute();
    return this.syncResult(plan, selected);
  }

  importAdditive(payload: unknown, sections: EnvConfigSection[]): EnvConfigImportResult {
    const selected = new Set<EnvConfigSection>(sections);
    const pkg = this.parsePackage(payload);
    // 模板的 custom:<key> 引用只在字段区段真正导入后才由包内字段补足（R4）。
    const plan = this.buildPlan(pkg, "additive", selected.has("customFields"));
    const execute = this.database.sqlite.transaction(() => {
      if (selected.has("customFields")) {
        pkg.customFields.forEach((field, index) => {
          if (plan.sections.customFields[index]?.action !== "create") return;
          const created = this.customFields.create({
            key: field.key,
            label: field.label,
            description: field.description,
            type: field.type,
            required: field.required,
            defaultValue: field.defaultValue,
            options: field.options,
          });
          // R1：sortOrder 缺省为数组位置；创建后按包中顺序落位。
          this.database.sqlite
            .prepare("UPDATE custom_field_definitions SET sort_order = ?, updated_at = ? WHERE id = ?")
            .run(field.sortOrder ?? index, nowIso(), created.id);
        });
      }
      if (selected.has("ownerAccountMappings")) {
        pkg.ownerAccountMappings.forEach((mapping, index) => {
          if (plan.sections.ownerAccountMappings[index]?.action !== "create") return;
          this.ownerAccounts.create({ ownerName: mapping.ownerName, account: mapping.account });
        });
      }
      if (selected.has("exportTemplates")) {
        pkg.exportTemplates.forEach((template, index) => {
          if (plan.sections.exportTemplates[index]?.action !== "create") return;
          this.spreadsheetTransfer.createTemplate({
            name: template.name,
            sheetName: template.sheetName,
            columns: template.columns,
          });
        });
      }
    });
    execute();
    return {
      sections: {
        customFields: plan.sections.customFields.map((item) => ({
          ...item,
          outcome: this.outcomeOf(item.action, selected.has("customFields")),
          options: undefined,
        })),
        ownerAccountMappings: plan.sections.ownerAccountMappings.map((item) => ({
          ...item,
          outcome: this.outcomeOf(item.action, selected.has("ownerAccountMappings")),
        })),
        exportTemplates: plan.sections.exportTemplates.map((item) => ({
          ...item,
          outcome: this.outcomeOf(item.action, selected.has("exportTemplates")),
        })),
      },
    };
  }

  private parsePackage(payload: unknown): EnvConfigPackage {
    try {
      return parseEnvConfigPackage(payload);
    } catch (error) {
      throw invalidInput(error instanceof Error ? error.message : "环境配置包格式无效");
    }
  }

  private buildPlan(pkg: EnvConfigPackage, mode: EnvConfigImportMode, resolvePackageFields: boolean): EnvConfigPlan {
    // key_exists 按全表判断（归档字段同样占用稳定键），引用解析只认可活动字段。
    const existingKeys = new Set(this.customFields.list(true).map((field) => field.key));
    const activeKeys = new Set(this.customFields.list(false).map((field) => field.key));
    const workPlanCount = (this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as CountRow).count;
    const fieldItems = pkg.customFields.map((field) => this.planFieldItem(field, existingKeys, workPlanCount));
    const resolvableKeys = new Set(activeKeys);
    if (resolvePackageFields) {
      for (const item of fieldItems) if (item.action === "create") resolvableKeys.add(item.key);
    }
    const existingOwners = new Set(this.ownerAccounts.list().map((mapping) => mapping.ownerName));
    const existingTemplateNames = new Set(this.spreadsheetTransfer.listTemplates(false).map((template) => template.name));
    const mappingItems = pkg.ownerAccountMappings.map((mapping) => this.planMappingItem(mapping, existingOwners));
    const templateItems = pkg.exportTemplates.map((template) => this.planTemplateItem(template, existingTemplateNames, resolvableKeys));
    const allItems: Array<{ grade: EnvConfigFieldPlanItem["grade"] }> = [...fieldItems, ...mappingItems, ...templateItems];
    return {
      mode,
      hasDestructiveChanges: allItems.some((item) => item.grade === "destructive"),
      sections: { customFields: fieldItems, ownerAccountMappings: mappingItems, exportTemplates: templateItems },
    };
  }

  /**
   * 同步计划（R5）：每区段按稳定身份差异对比，包内条目在前、仅本地存在的条目（退休/删除）追加在后。
   * 未选中的区段同样出现在计划里，但执行时跳过（R6）。
   */
  private buildSyncPlan(pkg: EnvConfigPackage, selected: ReadonlySet<EnvConfigSection>): EnvConfigPlan {
    const localFields = this.customFields.list(true);
    const localByKey = new Map(localFields.map((field) => [field.key, field]));
    const workPlanCount = (this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as CountRow).count;

    const packageKeys = new Set(pkg.customFields.map((field) => field.key));
    const fieldItems: EnvConfigFieldPlanItem[] = [];
    pkg.customFields.forEach((field, index) => {
      const local = localByKey.get(field.key);
      const item = local ? this.planSyncFieldUpdate(field, local, index) : this.planSyncFieldCreate(field, index, workPlanCount);
      if (item) fieldItems.push(item);
    });
    for (const local of localFields) {
      if (local.archivedAt || packageKeys.has(local.key)) continue;
      fieldItems.push({ action: "retire", grade: "destructive", reason: null, key: local.key, label: local.label });
    }

    // 模板字段引用按同步后的活动键集合解析；字段区段未选中时不发生增删，沿用本地活动集合。
    const resolvableKeys = new Set(localFields.filter((field) => !field.archivedAt).map((field) => field.key));
    if (selected.has("customFields")) {
      for (const local of localFields) {
        if (!local.archivedAt && !packageKeys.has(local.key)) resolvableKeys.delete(local.key);
      }
      for (const item of fieldItems) {
        if (item.action === "create" || item.action === "update" || item.action === "set_required") resolvableKeys.add(item.key);
      }
    }

    const localMappings = this.ownerAccounts.list();
    const mappingItems: EnvConfigMappingPlanItem[] = [];
    const packageOwners = new Set(pkg.ownerAccountMappings.map((mapping) => mapping.ownerName));
    for (const mapping of pkg.ownerAccountMappings) {
      const local = localMappings.find((candidate) => candidate.ownerName === mapping.ownerName);
      if (!local) {
        mappingItems.push({ action: "create", grade: "safe", reason: null, ownerName: mapping.ownerName, account: mapping.account });
      } else if (local.account !== mapping.account) {
        mappingItems.push({ action: "update", grade: "safe", reason: null, ownerName: mapping.ownerName, account: mapping.account });
      }
    }
    for (const local of localMappings) {
      if (!packageOwners.has(local.ownerName)) {
        mappingItems.push({ action: "delete", grade: "destructive", reason: null, ownerName: local.ownerName, account: local.account });
      }
    }

    const localTemplates = this.spreadsheetTransfer.listTemplates(false);
    const templateItems: EnvConfigTemplatePlanItem[] = [];
    const packageTemplateNames = new Set(pkg.exportTemplates.map((template) => template.name));
    for (const template of pkg.exportTemplates) {
      const local = localTemplates.find((candidate) => candidate.name === template.name);
      if (!local) {
        templateItems.push(this.unresolvedTemplateRef(template, resolvableKeys)
          ? { action: "skip", grade: "safe", reason: "missing_field_ref", name: template.name, sheetName: template.sheetName }
          : { action: "create", grade: "safe", reason: null, name: template.name, sheetName: template.sheetName });
        continue;
      }
      const differs = local.sheetName !== template.sheetName || JSON.stringify(local.columns) !== JSON.stringify(template.columns);
      if (!differs) continue;
      templateItems.push(this.unresolvedTemplateRef(template, resolvableKeys)
        ? { action: "skip", grade: "safe", reason: "missing_field_ref", name: template.name, sheetName: template.sheetName }
        : { action: "update", grade: "safe", reason: null, name: template.name, sheetName: template.sheetName });
    }
    for (const local of localTemplates) {
      if (!packageTemplateNames.has(local.name)) {
        templateItems.push({ action: "delete", grade: "destructive", reason: null, name: local.name, sheetName: local.sheetName });
      }
    }

    const hasDestructive = fieldItems.some((item) => item.grade === "destructive" || (item.options ?? []).some((option) => option.grade === "destructive"))
      || mappingItems.some((item) => item.grade === "destructive")
      || templateItems.some((item) => item.grade === "destructive");
    return {
      mode: "sync",
      hasDestructiveChanges: hasDestructive,
      sections: { customFields: fieldItems, ownerAccountMappings: mappingItems, exportTemplates: templateItems },
    };
  }

  private planSyncFieldCreate(field: PackageField, index: number, workPlanCount: number): EnvConfigFieldPlanItem {
    const identity = { key: field.key, label: field.label };
    if (field.options.length === 0 && ["single_select", "multi_select"].includes(field.type)) {
      return { ...identity, ...this.skipped("select_without_options") };
    }
    if (field.required && field.defaultValue == null && workPlanCount > 0) {
      return { ...identity, ...this.skipped("required_without_default") };
    }
    return { ...identity, action: "create", grade: "safe", reason: null };
  }

  /** 对本地已存在的字段做差异计划；类型冲突只报告不执行；无任何差异时省略该条目。 */
  private planSyncFieldUpdate(field: PackageField, local: CustomFieldDefinition, index: number): EnvConfigFieldPlanItem | null {
    const identity = { key: field.key, label: field.label };
    if (field.type !== local.type) {
      return { ...identity, action: "skip", grade: "destructive", reason: "type_conflict" };
    }
    const setRequired = field.required && !local.required;
    if (setRequired && field.defaultValue == null) {
      return { ...identity, ...this.skipped("required_without_default") };
    }
    const options = this.planOptionDiff(field, local);
    const fieldChanged = field.label !== local.label
      || field.description !== local.description
      || JSON.stringify(field.defaultValue ?? null) !== JSON.stringify(local.defaultValue ?? null)
      || (field.sortOrder ?? index) !== local.sortOrder
      || field.required !== local.required
      || Boolean(local.archivedAt);
    if (!fieldChanged && options.length === 0) return null;
    return {
      ...identity,
      action: setRequired ? "set_required" : "update",
      grade: setRequired ? "destructive" : "safe",
      reason: null,
      ...(options.length > 0 ? { options } : {}),
    };
  }

  /** 选项按 value 匹配：包内缺项补增，标签漂移或已归档的选项恢复，本地多出的活动选项退休。 */
  private planOptionDiff(field: PackageField, local: CustomFieldDefinition): EnvConfigOptionPlanItem[] {
    const items: EnvConfigOptionPlanItem[] = [];
    const localByValue = new Map(local.options.map((option) => [option.value, option]));
    const packageValues = new Set(field.options.map((option) => option.value));
    for (const option of field.options) {
      const localOption = localByValue.get(option.value);
      if (!localOption) {
        items.push({ action: "add_option", grade: "safe", reason: null, value: option.value, label: option.label });
      } else if (localOption.archivedAt || localOption.label !== option.label) {
        items.push({ action: "update_option", grade: "safe", reason: null, value: option.value, label: option.label });
      }
    }
    for (const option of local.options) {
      if (option.archivedAt || packageValues.has(option.value)) continue;
      items.push({ action: "retire_option", grade: "destructive", reason: null, value: option.value, label: option.label });
    }
    return items;
  }

  private sectionHasDestructive(plan: EnvConfigPlan, section: EnvConfigSection): boolean {
    if (section === "customFields") {
      return plan.sections.customFields.some((item) => item.grade === "destructive" || (item.options ?? []).some((option) => option.grade === "destructive"));
    }
    if (section === "ownerAccountMappings") return plan.sections.ownerAccountMappings.some((item) => item.grade === "destructive");
    return plan.sections.exportTemplates.some((item) => item.grade === "destructive");
  }

  /** 字段区段执行：包内条目按计划落库，本地多余字段走归档退休；选项先增后改，字段更新后退休。 */
  private executeSyncFields(pkg: EnvConfigPackage, plan: EnvConfigPlan): void {
    const packageByKey = new Map(pkg.customFields.map((field, index) => [field.key, { field, index }]));
    for (const item of plan.sections.customFields) {
      if (item.action === "skip") continue;
      if (item.action === "create") {
        const { field, index } = packageByKey.get(item.key)!;
        const created = this.customFields.create({
          key: field.key,
          label: field.label,
          description: field.description,
          type: field.type,
          required: field.required,
          defaultValue: field.defaultValue,
          options: field.options,
        });
        // R1：sortOrder 缺省为数组位置；创建后按包中顺序落位。
        this.database.sqlite
          .prepare("UPDATE custom_field_definitions SET sort_order = ?, updated_at = ? WHERE id = ?")
          .run(field.sortOrder ?? index, nowIso(), created.id);
        continue;
      }
      const local = this.customFields.list(true).find((candidate) => candidate.key === item.key);
      if (!local) continue;
      if (item.action === "retire") {
        // 退休即归档：定义与现有值一并保留（R5）。
        this.customFields.update(local.id, { archived: true, version: local.version });
        continue;
      }
      const { field, index } = packageByKey.get(item.key)!;
      const options = item.options ?? [];
      const localOptionByValue = new Map(local.options.map((option) => [option.value, option]));
      for (const option of options) {
        if (option.action !== "add_option") continue;
        this.customFields.addOption(local.id, { value: option.value, label: option.label });
      }
      for (const option of options) {
        if (option.action !== "update_option") continue;
        const localOption = localOptionByValue.get(option.value);
        if (!localOption) continue;
        this.customFields.updateOption(localOption.id, {
          label: option.label,
          ...(localOption.archivedAt ? { archived: false } : {}),
          version: localOption.version,
        });
      }
      this.customFields.update(local.id, {
        label: field.label,
        description: field.description,
        required: field.required,
        defaultValue: field.defaultValue,
        ...(local.archivedAt ? { archived: false } : {}),
        version: local.version,
      });
      if ((field.sortOrder ?? index) !== local.sortOrder) {
        this.database.sqlite
          .prepare("UPDATE custom_field_definitions SET sort_order = ?, updated_at = ? WHERE id = ?")
          .run(field.sortOrder ?? index, nowIso(), local.id);
      }
      for (const option of options) {
        if (option.action !== "retire_option") continue;
        const localOption = localOptionByValue.get(option.value);
        if (!localOption) continue;
        this.customFields.updateOption(localOption.id, { archived: true, version: localOption.version });
      }
      // 选项顺序收敛到包中顺序，保证再导出与包一致。
      if (options.length > 0) {
        const normalized = this.customFields.list(true).find((candidate) => candidate.id === local.id)!;
        field.options.forEach((packageOption, position) => {
          const target = normalized.options.find((candidate) => candidate.value === packageOption.value);
          if (target) this.database.sqlite.prepare("UPDATE custom_field_options SET sort_order = ? WHERE id = ?").run(position, target.id);
        });
      }
    }
  }

  private executeSyncMappings(plan: EnvConfigPlan): void {
    for (const item of plan.sections.ownerAccountMappings) {
      if (item.action === "create") this.ownerAccounts.create({ ownerName: item.ownerName, account: item.account });
      else if (item.action === "update") this.ownerAccounts.update(item.ownerName, { ownerName: item.ownerName, account: item.account });
      else if (item.action === "delete") this.ownerAccounts.delete(item.ownerName);
    }
  }

  private executeSyncTemplates(pkg: EnvConfigPackage, plan: EnvConfigPlan): void {
    const packageByName = new Map(pkg.exportTemplates.map((template) => [template.name, template]));
    for (const item of plan.sections.exportTemplates) {
      if (item.action === "create") {
        const template = packageByName.get(item.name)!;
        this.spreadsheetTransfer.createTemplate({ name: template.name, sheetName: template.sheetName, columns: template.columns });
        continue;
      }
      const local = this.spreadsheetTransfer.listTemplates(false).find((candidate) => candidate.name === item.name);
      if (!local) continue;
      if (item.action === "update") {
        const template = packageByName.get(item.name)!;
        this.spreadsheetTransfer.updateTemplate(local.id, { name: template.name, sheetName: template.sheetName, columns: template.columns, version: local.version });
      } else if (item.action === "delete") {
        this.spreadsheetTransfer.deleteTemplate(local.id, local.version);
      }
    }
  }

  private syncResult(plan: EnvConfigPlan, selected: ReadonlySet<EnvConfigSection>): EnvConfigImportResult {
    const outcome = (action: EnvConfigAction): EnvConfigImportOutcome => {
      if (action === "skip") return "skipped";
      if (action === "create") return "created";
      if (action === "retire") return "retired";
      if (action === "delete") return "deleted";
      return "updated";
    };
    const optionOutcome = (action: EnvConfigOptionAction): EnvConfigImportOutcome => {
      if (action === "add_option") return "created";
      if (action === "retire_option") return "retired";
      return "updated";
    };
    const fieldsSelected = selected.has("customFields");
    const mappingsSelected = selected.has("ownerAccountMappings");
    const templatesSelected = selected.has("exportTemplates");
    return {
      sections: {
        customFields: plan.sections.customFields.map((item) => {
          const { options, ...rest } = item;
          return {
            ...rest,
            outcome: fieldsSelected ? outcome(item.action) : "not_selected",
            ...(options
              ? { options: options.map((option) => ({ ...option, outcome: fieldsSelected ? optionOutcome(option.action) : "not_selected" })) }
              : {}),
          };
        }),
        ownerAccountMappings: plan.sections.ownerAccountMappings.map((item) => ({
          ...item,
          outcome: mappingsSelected ? outcome(item.action) : "not_selected",
        })),
        exportTemplates: plan.sections.exportTemplates.map((item) => ({
          ...item,
          outcome: templatesSelected ? outcome(item.action) : "not_selected",
        })),
      },
    };
  }

  private planFieldItem(field: PackageField, existingKeys: ReadonlySet<string>, workPlanCount: number): EnvConfigFieldPlanItem {
    const identity = { key: field.key, label: field.label };
    if (existingKeys.has(field.key)) return { ...identity, ...this.skipped("key_exists") };
    if (field.options.length === 0 && ["single_select", "multi_select"].includes(field.type)) {
      return { ...identity, ...this.skipped("select_without_options") };
    }
    if (field.required && field.defaultValue == null && workPlanCount > 0) {
      return { ...identity, ...this.skipped("required_without_default") };
    }
    return { ...identity, action: "create", grade: "safe", reason: null };
  }

  private planMappingItem(mapping: PackageMapping, existingOwners: ReadonlySet<string>): EnvConfigMappingPlanItem {
    const identity = { ownerName: mapping.ownerName, account: mapping.account };
    if (existingOwners.has(mapping.ownerName)) return { ...identity, ...this.skipped("owner_exists") };
    return { ...identity, action: "create", grade: "safe", reason: null };
  }

  private planTemplateItem(
    template: PackageTemplate,
    existingNames: ReadonlySet<string>,
    resolvableKeys: ReadonlySet<string>,
  ): EnvConfigTemplatePlanItem {
    const identity = { name: template.name, sheetName: template.sheetName };
    if (existingNames.has(template.name)) return { ...identity, ...this.skipped("template_name_exists") };
    if (this.unresolvedTemplateRef(template, resolvableKeys)) return { ...identity, ...this.skipped("missing_field_ref") };
    return { ...identity, action: "create", grade: "safe", reason: null };
  }

  private unresolvedTemplateRef(template: PackageTemplate, resolvableKeys: ReadonlySet<string>): boolean {
    return template.columns.some(
      (column) => column.source.startsWith("custom:") && !resolvableKeys.has(column.source.slice("custom:".length)),
    );
  }

  private skipped(reason: EnvConfigSkipReason): { action: "skip"; grade: "safe"; reason: EnvConfigSkipReason } {
    return { action: "skip", grade: "safe", reason };
  }

  private outcomeOf(action: EnvConfigFieldPlanItem["action"], selected: boolean): EnvConfigImportResult["sections"]["customFields"][number]["outcome"] {
    if (!selected) return "not_selected";
    return action === "skip" ? "skipped" : "created";
  }
}
