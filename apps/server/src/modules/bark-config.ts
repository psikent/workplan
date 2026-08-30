import type { BarkConfig, BarkTestPushResponse, UpdateBarkConfig } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { AppError } from "../errors.js";
import { sendBark, type BarkMessage } from "./bark-client.js";

export const DEFAULT_BARK_SERVER_URL = "https://api.day.app";
export const BARK_CONFIG_ROW_ID = 1;
export const BARK_TEST_PUSH_TITLE = "Bark 推送测试";
export const BARK_TEST_PUSH_GROUP = "work-order-reminder";

type BarkConfigRow = {
  server_url: string;
  device_key: string | null;
};

// Bark 配置：全局唯一一行（id 固定 1），仅 Administrator 通过设置 API 读写（R2/D2/D6）。
export class BarkConfigService {
  constructor(private readonly database: DatabaseBundle) {}

  private getRow(): BarkConfigRow | undefined {
    return this.database.sqlite
      .prepare("SELECT server_url, device_key FROM bark_config WHERE id = ?")
      .get(BARK_CONFIG_ROW_ID) as BarkConfigRow | undefined;
  }

  /** 无行时返回默认值（默认服务器 + Key 为空 = 推送关闭）。 */
  get(): BarkConfig {
    const row = this.getRow();
    return row
      ? { serverUrl: row.server_url, deviceKey: row.device_key }
      : { serverUrl: DEFAULT_BARK_SERVER_URL, deviceKey: null };
  }

  /** upsert 单行；deviceKey 空字符串归一化为 null（推送关闭）。 */
  save(input: UpdateBarkConfig): BarkConfig {
    const deviceKey = input.deviceKey && input.deviceKey.length > 0 ? input.deviceKey : null;
    this.database.sqlite
      .prepare(`
        INSERT INTO bark_config(id, server_url, device_key, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, device_key = excluded.device_key, updated_at = excluded.updated_at
      `)
      .run(BARK_CONFIG_ROW_ID, input.serverUrl, deviceKey, new Date().toISOString());
    return { serverUrl: input.serverUrl, deviceKey };
  }

  /** 向当前配置发送固定测试文案；未配置 Key 时返回明确 400。 */
  async sendTestPush(): Promise<BarkTestPushResponse> {
    const config = this.get();
    if (!config.deviceKey) {
      throw new AppError(400, "BARK_NOT_CONFIGURED", "请先配置 Bark 设备 Key 再发送测试推送");
    }
    try {
      await sendBark(
        { serverUrl: config.serverUrl, deviceKey: config.deviceKey },
        this.testMessage(),
      );
      return { success: true, message: "测试推送成功" };
    } catch (error) {
      return { success: false, message: `测试推送失败：${error instanceof Error ? error.message : "未知错误"}` };
    }
  }

  private testMessage(): BarkMessage {
    return {
      title: BARK_TEST_PUSH_TITLE,
      body: "这是一条来自工作计划系统的测试推送。",
      group: BARK_TEST_PUSH_GROUP,
    };
  }
}
