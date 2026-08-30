// Bark 推送客户端：Bark 为 URL 路径式 API —— `GET {server_url}/{device_key}?title=…&body=…&group=…`。
// 仅供配置测试推送（票据 02）与每日调度（票据 03）复用，外部不可直接访问。

export const BARK_REQUEST_TIMEOUT_MS = 5_000;

export type BarkDestination = {
  serverUrl: string;
  deviceKey: string;
};

export type BarkMessage = {
  title: string;
  body: string;
  group: string;
};

export async function sendBark(destination: BarkDestination, message: BarkMessage): Promise<void> {
  const url = new URL(destination.serverUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/${encodeURIComponent(destination.deviceKey)}`;
  url.searchParams.set("title", message.title);
  url.searchParams.set("body", message.body);
  url.searchParams.set("group", message.group);

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(BARK_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Bark 服务器返回 ${response.status}（${detail.slice(0, 200)}）`);
  }
}
