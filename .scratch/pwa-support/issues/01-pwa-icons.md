# 01 扩展 favicon 脚本输出 PWA 图标

Status: resolved

扩展 `apps/web/scripts/generate-favicons.mjs`，新增输出：

- `pwa-192x192.png`、`pwa-512x512.png`：延续现有视觉（#3157df 圆角瓷贴 + 白色日历图形）。
- `pwa-maskable-192x192.png`、`pwa-maskable-512x512.png`：满铺 #3157df 方形，白色日历图形居中且缩至安全区（约 80%）内。

运行 `pnpm favicons` 重新生成，产物提交进 `apps/web/public/`。

验收：四个 PNG 尺寸/模式正确；原有 favicon.svg/ico、apple-touch-icon.png 输出不回归。

Blocked by: (none)

## Comments

2026-09-02: 已实现并通过验收（build/typecheck/test 全绿；本地 prod 冒烟：SW 激活、图标 200、离线重试态、重建后更新提示与刷新均验证通过）。详见 spec.md。
