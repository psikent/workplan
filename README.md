# 工作计划

一个以单一 `WorkPlan` 为核心的个人工作计划管理服务。它提供中文 Web UI、REST API、SQLite 持久化、周/月甘特图、自定义字段、重复排程、JSON 迁移能力与 Bark 推送（每日 09:30 推送检修单提醒）。

## 正式环境

生产平台行为按宿主系统分为两类：

- **Linux（systemd）**：唯一受支持的生产形式。应用进程永远以非 root 的 `workplan:workplan` 账户运行，由 `/etc/systemd/system/workplan.service` 监管；发布脚本只负责部署文件与控制 systemd，绝不启动脱离 systemd 的进程。
- **macOS（launchd）与自定义隔离目录**：沿用原有的 launchd / 手动管理器行为，不受 systemd 影响。

正式环境使用 Node.js 22 或更高版本，固定发布到源码目录同级的 `workplan-release` 目录（Linux 生产路径约定为 `/var/opt/workplan-release`）。服务在 `127.0.0.1:3000` 提供 Web UI、API 和健康检查，公网 HTTPS 由 Caddy 提供。

### 首次安装（Linux，需要 root）

```bash
sudo node scripts/release.mjs --install-systemd
```

`--install-systemd` 仅在 Linux、默认正式发布目录、root 身份下有效（非法组合会在构建任何东西之前失败）。Linux 正式发布本身也不支持 `--no-start`（systemd 路径必须启动服务并完成验收），`--no-start` 仅用于自定义 `--target` 的隔离发布。它会：幂等创建 `workplan` 系统组与无登录 shell、无家目录的系统账户；生成并校验 `workplan.service`（`User=`/`Group=workplan`，绝对路径，直接监督 `apps/server/dist/index.js`，文件日志、重启策略、超时、`UMask=0077` 与 `NoNewPrivileges`/`PrivateTmp`/`ProtectSystem`/`ProtectHome` 加固基线）；备份并原子替换已有 unit；执行 `daemon-reload` 并在 `multi-user.target` 启用服务——然后才构建、发布并启动。

### 常规发布（Linux，需要 root）

```bash
sudo node scripts/release.mjs
```

发布顺序固定为：预检（Linux、root、`systemctl`/`systemd-analyze`、运行中的 systemd 管理器、现有 unit 安全）→ 构建 → 准备暂存 → `systemctl stop` → 提升程序文件 → 安装生产依赖 → 初始化生产配置 → 应用所有权权限 → 启动 → 验收。

- 常规发布**必须**存在且安全的 `workplan.service`；缺失或不安全时发布会中止并提示先运行 `--install-systemd`，**绝不会**回退到 `node workplan.mjs start`。
- 验收项：`systemd-analyze verify` 通过、`is-enabled`/`is-active` 成功、MainPID 为正且用户/组为 `workplan:workplan`、可执行文件与工作目录为正式路径、仅 `127.0.0.1:3000` 一个监听（无通配/公网绑定）、`/health/ready` 返回 `status=ready` 且 `database=ok`。
- 发布目录中的 `.env`、`data/` 和 `logs/` 不会被覆盖；任何阶段失败都会恢复上一版本程序文件、`.env` 与被替换的 unit，重启并验证上一版本。原始失败保留为发布失败，回滚问题单独报告。
- 上一版本程序备份保留在源码目录同级的 `workplan-release.previous-release`（仅一份），程序文件与依赖 root 所有、服务账户不可写。

### 服务生命周期（Linux）

```bash
sudo systemctl status workplan
sudo systemctl start workplan
sudo systemctl stop workplan
sudo systemctl restart workplan
sudo systemctl enable workplan
```

诊断：

```bash
sudo journalctl -u workplan -n 100 --no-pager
tail -n 100 workplan-release/logs/workplan.log
tail -n 100 workplan-release/logs/workplan.err.log
```

应用日志写入 `workplan-release/logs/workplan.log` 与 `workplan-release/logs/workplan.err.log`（服务账户私有）；journal 用于 systemd 生命周期与故障诊断。

### 非 root 保证与安全边界（Linux）

- 部署（sudo）与运行（`workplan`）角色分离：root 只部署文件和控制 systemd，应用进程永不继承 root 身份；每次发布后都会验证 MainPID 的用户/组。
- `.env` 仅 root 可读（0600），由 systemd 在降权前读取；`data/`、`logs/`、`.runtime/` 归 `workplan:workplan` 私有，程序文件与生产依赖 root 所有且服务账户不可写；日志文件预先以私有权限创建。
- Linux 正式环境**不要**使用 `node workplan.mjs start|stop|restart`——那会绕过 unit 与固定服务身份。检测到 `workplan.service` 时，管理器会直接拒绝这些命令。手动管理器（`setup`/`start`/`stop`/`restart`/`status`/`logs`）仅用于 macOS launchd 与自定义 `--target --no-start` 隔离目录等非 systemd 工作流（`workplan.mjs setup` 会生成随机 `APP_SECRET`，已有有效密钥保留；正式数据库为 `workplan-release/data/workplan.db`）。
- 发布脚本不会连接或修改生产 VPS；对 VPS 的操作需要单独明确授权。

### 本地验证边界与已授权的 VPS 检查

本地仓库只能验证：构建、测试、unit 渲染/校验逻辑、发布流程的故障注入。发布到 VPS 后，由操作员在服务器上执行以下检查（需要另行授权）：

1. `sudo systemctl is-enabled workplan && sudo systemctl is-active workplan`
2. `sudo systemctl show workplan -p MainPID --value`，再 `ps -o user=,group= -p <PID>` 确认输出为 `workplan workplan`
3. 确认仅 `127.0.0.1:3000` 有监听（`sudo ss -ltnp 'sport = :3000'`，不得出现 `*:3000`/`0.0.0.0`）
4. `curl -fsS http://127.0.0.1:3000/health/ready` 返回 `{"status":"ready","database":"ok"}`
5. 公网 HTTPS 由 Caddy 提供：`curl -fsS https://<域名>/health/ready`

首次安装完成后打开 `http://127.0.0.1:3000`，使用日志中的一次性令牌初始化管理员。已有数据库包含管理员时不会重新初始化。

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
- 账户角色分为管理员、编辑者与只读账户（Viewer）：管理员可管理访问与全局定义；编辑者可查询并修改全部业务数据；只读账户只能查询、高级搜索与导出（JSON、模板 XLS 与自定义 XLS），调用任何业务写入或管理员接口都会返回 `403 INSUFFICIENT_PERMISSION`，且不产生任何数据变化。
- 管理员可以在账户管理页创建密码或仅 API Token 的编辑者与只读账户，并重置密码、签发或撤销 Token、停用或启用账户；账户角色创建后固定，不提供角色转换。
- 停用账户会立即撤销其全部会话与访问令牌；重新启用后旧凭据不会恢复，需要重新设置密码或签发新令牌。
- 前端对只读账户隐藏业务写入口，仅用于体验；服务端按路由能力授权是最终安全边界。
- 外部客户端可以创建个人访问令牌，以 `Authorization: Bearer wp_...` 调用 `/api/v1`。
- 密码使用 Argon2id；访问令牌和会话令牌只保存 SHA-256 哈希。
- JSON 导入会在单个事务内替换业务数据，但不会修改管理员账户、会话或访问令牌。
- SQLite 使用 WAL。复制数据库前应停止对应环境，或使用 SQLite Backup API/设置页 JSON 导出。
- 每个数据库只运行一个服务进程，避免 SQLite 写入和内置调度器重复执行。

登录后可在 `/api/docs` 查看 OpenAPI 文档；健康检查为 `/health/live` 与 `/health/ready`。
