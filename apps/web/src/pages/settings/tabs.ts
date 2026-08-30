export const settingsTabs = [
  { key: "environment", label: "环境配置" },
  { key: "transfer", label: "数据导入/导出" },
  { key: "accounts", label: "账户管理" },
  { key: "push", label: "推送配置" },
  { key: "api-docs", label: "接口文档" },
] as const;

export type SettingsTabKey = (typeof settingsTabs)[number]["key"];

export const defaultSettingsTab: SettingsTabKey = "environment";

const settingsTabKeys = new Set<string>(settingsTabs.map((tab) => tab.key));

export function isSettingsTab(value: string | null): value is SettingsTabKey {
  return typeof value === "string" && settingsTabKeys.has(value);
}

export function settingsPath(tab: SettingsTabKey): string {
  return `/settings?tab=${tab}`;
}
