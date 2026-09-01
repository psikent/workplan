# 02 vite-plugin-pwa 构建配置

Status: resolved

- `apps/web` 安装 `vite-plugin-pwa`（须支持 Vite 7 的 v1.x，安装时确认 peer 无警告）。
- `apps/web/vite.config.ts` 接入 `VitePWA`：
  - `registerType: 'prompt'`。
  - manifest 见 spec：工作计划 / zh-CN / standalone / `#f6f8fb` / 指向 01 产出的图标（常规 + maskable，`purpose` 正确标注）。
  - workbox：`globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']`（排除 `.map`）、`navigateFallback: 'index.html'`、`navigateFallbackDenylist: [/^\/api\//, /^\/health\//]`、`cleanupOutdatedCaches: true`、不加 runtimeCaching。
- dev 模式不启用 SW（保持默认 `devOptions.enabled: false`）。

验收：`pnpm build` 后 `dist/` 含 `sw.js`、`manifest.webmanifest`（或 `manifest.webmanifest.gz`），index.html 注入 manifest 链接与 SW 注册；`workbox-*.js` 预缓存清单包含全部路由 chunk 且不含 `.map`。

Blocked by: 01

## Comments

2026-09-02: 已实现并通过验收（build/typecheck/test 全绿；本地 prod 冒烟：SW 激活、图标 200、离线重试态、重建后更新提示与刷新均验证通过）。详见 spec.md。
