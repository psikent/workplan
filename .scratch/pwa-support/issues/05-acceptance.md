# 05 PWA 验收

Status: resolved

- `pnpm build && pnpm typecheck && pnpm test` 全绿。
- 本地起 prod 形态服务（Fastify 托管 dist）：
  - DevTools/Application：manifest 解析无错误、SW 已激活并预缓存；
  - 勾选 Offline 后刷新：外壳打开（登录用户看到离线态或空数据页，而非白屏/死屏）；
  - 改动资源重新构建后：出现「新版本可用」提示，点击刷新后版本生效。
- `curl -I` 核对 `/assets/*.js`、`/sw.js`、`/`、`/manifest.webmanifest` 的 Cache-Control 与 Content-Type。
- 更新 `.scratch/pwa-support/` 各票据 Status 与 Comments。

Blocked by: 01, 02, 03, 04

## Comments

2026-09-02: 已实现并通过验收（build/typecheck/test 全绿；本地 prod 冒烟：SW 激活、图标 200、离线重试态、重建后更新提示与刷新均验证通过）。详见 spec.md。
