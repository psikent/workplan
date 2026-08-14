# 工作计划

一个以单一 `WorkPlan` 为核心的个人工作计划管理服务。它提供中文 Web UI、REST API、SQLite 持久化、周/月甘特图、自定义字段、重复排程与 JSON 迁移能力。

## 正式环境

正式环境使用 Node.js 22 或更高版本，固定发布到源码目录同级的 `workplan-release` 目录。服务在端口 `3000` 同时提供 Web UI、API 和健康检查。

从源码目录执行一键构建和发布：

```powershell
node scripts/release.mjs
```

发布脚本会构建源码、安装生产依赖、停止旧进程、替换程序并重新启动。发布目录中的 `.env`、`data/` 和 `logs/` 不会被覆盖；新版本启动失败时会恢复上一版本。

在发布目录管理服务：

```powershell
node workplan.mjs setup
node workplan.mjs start
node workplan.mjs stop
node workplan.mjs restart
node workplan.mjs status
node workplan.mjs logs 100
```

`setup` 会在配置缺失时生成随机 `APP_SECRET`，已有有效密钥会始终保留。正式数据库固定为 `workplan-release\data\workplan.db`。

首次安装时打开 `http://localhost:3000`，使用日志中的一次性令牌初始化管理员。已有数据库包含管理员时不会重新初始化。

## 本地开发

项目通过 Corepack 使用 `packageManager` 中固定的 pnpm 版本：

```powershell
corepack pnpm install
corepack pnpm dev
```

前端运行在 `http://localhost:5173`，开发后端运行在 `http://localhost:3002`，前端会将 `/api` 和 `/health` 转发到开发后端。开发数据库固定为源码根目录的 `data\workplan.db`，与正式数据库完全独立。

常用检查：

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## 配置

正式环境配置位于发布目录的 `.env`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 正式环境固定值 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATA_DIR` | `./data` | 相对于项目或发布根目录的数据目录 |
| `APP_SECRET` | 首次自动生成 | 至少 32 个字符，用于签名会话 Cookie |
| `APP_BASE_URL` | `http://localhost:3000` | 外部访问地址，用于 Origin 校验和 OpenAPI |
| `TZ` | `Asia/Shanghai` | 新建重复规则使用的默认时区 |
| `SESSION_DAYS` | `30` | 浏览器会话有效天数 |

`DATA_DIR` 的相对路径始终根据项目根目录解析，不受启动命令当前目录影响。

## 数据与安全

- UI 使用签名、`HttpOnly`、`SameSite=Lax` Cookie；写请求需要 CSRF 令牌并校验 Origin。
- 管理员可以在设置页创建密码编辑者，或为现有仅 Token 编辑者设置密码。
- 外部客户端可以创建个人访问令牌，以 `Authorization: Bearer wp_...` 调用 `/api/v1`。
- 密码使用 Argon2id；访问令牌和会话令牌只保存 SHA-256 哈希。
- JSON 导入会在单个事务内替换业务数据，但不会修改管理员账户、会话或访问令牌。
- SQLite 使用 WAL。复制数据库前应停止对应环境，或使用 SQLite Backup API/设置页 JSON 导出。
- 每个数据库只运行一个服务进程，避免 SQLite 写入和内置调度器重复执行。

登录后可在 `/api/docs` 查看 OpenAPI 文档；健康检查为 `/health/live` 与 `/health/ready`。
