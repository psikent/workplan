# 04 服务端静态缓存头

Status: resolved

`apps/server/src/app.ts` 静态托管处（当前 268-283 行）：

- `@fastify/static` 增加 `setHeaders`：
  - 路径位于 `assets/` 下（文件名带内容哈希）→ `Cache-Control: public, max-age=31536000, immutable`；
  - `sw.js` → `Cache-Control: public, max-age=0, must-revalidate`；
  - 其余（index.html、manifest、favicon、apple-touch-icon 等）→ `Cache-Control: no-cache`。
- SPA fallback（setNotFoundHandler 返回 index.html）补 `Cache-Control: no-cache`。
- 在 apps/server 现有测试体系补缓存头断言（三类路径 + fallback）。

验收：`curl -I` 核对上述响应头；`.webmanifest` 返回正确 Content-Type；服务端测试全绿。

Blocked by: (none)

## Comments

2026-09-02: 已实现并通过验收（build/typecheck/test 全绿；本地 prod 冒烟：SW 激活、图标 200、离线重试态、重建后更新提示与刷新均验证通过）。详见 spec.md。
