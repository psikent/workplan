# PWA 支持：可安装 + 离线外壳

Status: ready-for-agent

## 背景

「工作计划」前端是 React 19 + Vite 7 SPA，由 Fastify 在生产环境托管 `apps/web/dist`。当前没有任何 PWA 能力：无 manifest、无 service worker、无静态缓存头。用户已确认三个决策：

1. **离线范围**：可安装 + 离线外壳。断网时应用外壳可打开，页面框架可用；API 数据不缓存，数据请求照常失败并提示。
2. **更新策略**：提示刷新。检测到新版本时弹「新版本可用」提示，用户确认后刷新，不打断未保存的编辑。
3. **缓存头**：顺带修复服务端静态文件缺失 Cache-Control 的问题（这是 SW 正确更新的前提）。

## 需求

### 可安装

- Web App Manifest（`manifest.webmanifest`）：name/short_name「工作计划」、`lang: zh-CN`、`start_url: /`、`scope: /`、`display: standalone`、`background_color`/`theme_color: #f6f8fb`（与现有 theme-color meta 对齐；深色跟随仍由 media query meta 负责）。
- 图标：192/512 常规 + 192/512 maskable PNG，由现有无依赖脚本 `apps/web/scripts/generate-favicons.mjs` 扩展生成，产物提交进 `apps/web/public/`。

### 离线外壳

- Service worker（vite-plugin-pwa + workbox GenerateSW）预缓存构建产物（JS/CSS/HTML/图标/manifest），**排除 sourcemap**。
- `/api`、`/health` 一律不经过 SW（不缓存、不回退），cookie 会话与 CSRF 逻辑不受影响。
- SPA 路由导航离线时回退到预缓存的 `index.html`。

### 离线与更新 UX

- 启动引导（App.tsx 的 `/setup/status` + `/auth/me`）在网络失败时显示「网络不可用 + 重试」，修复断网时永远停在「正在载入…」的缺陷。
- `useOnline` hook + AppShell 离线提示条。
- 新版本可用时（SW waiting）显示「新版本可用 → 刷新」提示，点击后 `updateSW(true)`。
- 所有新样式补 `:root[data-theme="dark"]` 覆盖。

### 服务端缓存头

- `assets/*`（文件名带内容哈希）→ `public, max-age=31536000, immutable`。
- `sw.js` → `public, max-age=0, must-revalidate`。
- 其余静态文件（index.html、manifest、图标）与 SPA fallback → `no-cache`。

## 非目标

- 不缓存 API 响应、不做离线只读数据或离线编辑队列。
- 不做推送通知。
- 不改变发布流程（`release.mjs` 原样搬运 dist，无需改动）。

## 验收标准

- `pnpm build && pnpm typecheck && pnpm test` 全绿。
- 本地 prod 形态（Fastify 托管 dist）：DevTools Application 面板 manifest 有效、SW 已激活；勾选 Offline 后刷新，外壳可打开。
- 更新流程：改动后重新构建，出现刷新提示，点击后新版本生效。
- `curl -I` 核对三类缓存头与 `.webmanifest` 的 Content-Type。

## 票据

见 `issues/`：01 图标、02 PWA 构建配置、03 离线与更新 UX、04 服务端缓存头、05 验收。
