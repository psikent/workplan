# 工作计划

一个以单一 `WorkPlan` 为核心的个人工作计划管理服务。它提供中文 Web UI、REST API、SQLite 持久化、周/月甘特图、自定义字段、重复排程与 JSON 迁移能力。

## Docker 启动

1. 生成应用密钥并写入本地 `.env`：

   ```bash
   printf 'APP_SECRET=%s\n' "$(openssl rand -base64 32)" > .env
   ```

2. 在发布目录构建版本化镜像：

   ```bash
   docker build --pull --tag workplan:0.1.0 .
   ```

3. 校验 Compose 配置并启动已经构建的镜像：

   ```bash
   docker compose config
   docker compose up -d
   ```

   Compose 默认使用 `workplan:0.1.0`。如需使用其他标签，在 `.env` 中设置 `WORKPLAN_IMAGE`；宿主机端口可通过 `WORKPLAN_PORT` 调整。

4. 查看首次初始化令牌：

   ```bash
   docker compose logs workplan
   ```

5. 打开 `http://localhost:3000`，输入日志中的一次性令牌并设置管理员用户名和密码。初始化令牌 30 分钟后失效，完成初始化后立即作废。

数据保存在 Docker 卷 `workplan-data` 中的 `/data/workplan.db`。生产环境应通过反向代理提供 HTTPS，并将 `APP_BASE_URL` 设置为外部 HTTPS 地址。

## 本地开发

需要 Node.js 22 或更高版本。项目通过 Corepack 使用 `packageManager` 中固定的 pnpm 版本，不要求系统预先安装 `pnpm` shim：

```bash
corepack pnpm install
corepack pnpm dev
```

前端默认运行在 `http://localhost:5173`，并将 `/api` 和 `/health` 转发到 `http://localhost:3000`。

常用检查：

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WORKPLAN_IMAGE` | `workplan:0.1.0` | Compose 启动的发布镜像标签 |
| `WORKPLAN_PORT` | `3000` | Compose 映射到宿主机的端口 |
| `APP_SECRET` | 开发环境使用临时值 | 生产环境必填，至少 32 个字符，用于签名会话 Cookie |
| `APP_BASE_URL` | `http://localhost:3000` | 外部访问地址，用于 Origin 校验和 OpenAPI |
| `DATA_DIR` | `./data` | SQLite 数据目录；容器内固定为 `/data` |
| `PORT` | `3000` | HTTP 监听端口 |
| `TZ` | `Asia/Shanghai` | 新建重复规则使用的默认时区 |
| `SESSION_DAYS` | `30` | 浏览器会话有效天数 |

## 数据与安全

- UI 使用签名、`HttpOnly`、`SameSite=Lax` Cookie；写请求需要 CSRF 令牌并校验 Origin。
- 管理员可以在设置页创建密码编辑者，或为现有仅 Token 编辑者设置密码；密码编辑者可登录 Web 工作台并操作全部工作计划，但不能管理账户、全局字段和数据导入。
- 外部客户端可以在设置页创建个人访问令牌，以 `Authorization: Bearer wp_...` 调用 `/api/v1`。
- 密码使用 Argon2id；访问令牌和会话令牌只保存 SHA-256 哈希。
- JSON 导入会在单个事务内替换业务数据，但不会修改管理员账户、会话或访问令牌。
- SQLite 使用 WAL。复制数据库文件前应停止容器，或使用设置页的 JSON 导出功能。
- 当前版本只支持单容器实例，避免 SQLite 写入和内置调度器重复执行。

登录后可在 `/api/docs` 查看 OpenAPI 文档；健康检查为 `/health/live` 与 `/health/ready`。
