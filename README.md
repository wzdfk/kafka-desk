# KafkaDesk · 个人用简易 Kafka 客户端

本地单机 Kafka 收发与订阅调试工具：Express 后端（`server.js`，SSE 推送）+ 双前端并存 —— **旧版** `public/`（原生 JS）与 **新版** `web/`（Vue3 + Naive UI + Pinia，Apple 风格）。

## 启动方式

| 方式 | 命令 | 前端 | 说明 |
|---|---|---|---|
| 网页端（推荐日常） | 双击 `start.bat` | 旧版 `public/` | 端口 18761，自动装依赖、拉起浏览器 `--app` 窗口；重复执行只开新窗口不重启服务 |
| 网页端（Vue3 版） | `set KAFKA_DESK_STATIC=web/dist && node server.js` | 新版 `web/dist` | 需先构建：`npm --prefix web install && npm --prefix web run build` |
| Electron 开发态 | `npm run app` | 新版 `web/dist` | 随机端口，不影响 18761 实例；未构建 dist 时自动回退旧版 |
| 打包 portable exe | `npm run dist` | 新版 `web/dist` | 自动先执行 vite 构建，产物在 `kafka_app/`；数据写入 userData，不写安装目录 |

> 新版前端功能与旧版全量对齐；`KAFKA_DESK_STATIC` 指向的目录缺 `index.html` 时服务端自动回退 `public/`（旧版路径永远可用）。

## 前端开发（web/）

```bash
# 方式1
npm start
cd web
npm install
npm run dev    # http://localhost:5173，/api 代理到 127.0.0.1:18761（需先启动后端）
npm test       # node --test 单元测试

# 打包
npm run build  # 产出 web/dist

# 方式2 
npm run app

# 打包
npm run dist

```

## 环境变量（server.js / Electron）

| 变量 | 默认 | 说明 |
|---|---|---|
| `KAFKA_DESK_PORT` | `18761` | HTTP 端口（Electron 固定用随机端口） |
| `KAFKA_DESK_HOST` | `127.0.0.1` | 监听地址，勿暴露公网 |
| `KAFKA_DESK_DEMO` | 关闭 | `=1` 开演示模式：不连真实 Broker，回显假消息 |
| `KAFKA_DESK_DATA` | `<repo>/data`（打包后 userData） | registry / 配置持久化目录 |
| `KAFKA_DESK_STATIC` | `public` | 静态前端目录，可指向 `web/dist` 切换 Vue3 版 |

## 自检脚本

| 命令 | 检查内容 |
|---|---|
| `npm run verify` | Electron 集成：动态端口启动、打包必备文件、主进程安全配置 |
| `npm run verify:web` | Vue3 工程：源文件齐全、vite 构建、单测、代理配置 |
| `npm run verify:integration` | 静态切换：web/dist 生效 / 默认旧版 / 目录缺失回退 三场景真实启动验证 |
| `npm run verify:update` | 版本更新离线自检：四处版本一致、注入链路、IPC 契约、URL 白名单、SHA256、降级判定、runner 临时目录「替换 + 回滚」沙盒演练（不碰真实 exe） |
| `npm run release -- baseline --dry-run` | 发版脚本预演（不写文件、不推送） |

## 版本与更新

- **事实源**：GitHub Releases（`wzdfk/kafka-desk`），版本号唯一来源是根 `package.json`（构建时注入 `web/dist`）。
- **免限流读取**：版本列表由本地后端 `GET /api/app/releases` 代取 GitHub 的 **releases.atom**（无 REST API 的 60 次/小时未认证配额），内存缓存 10 分钟；前端优先走该接口，只有旧后端或代理失败时才回退直连 `api.github.com`。
- **检查更新**：设置 → 关于 →「版本与更新」。进入该分区自动检查（成功缓存 24h / 失败 30min / 手动 60s 节流）；限流或离线时显示上次缓存并给出「打开 Releases 页」入口。
- **版本历史**：下拉里每个版本都带动作 —— 比当前新显示「更新」，比当前旧显示「安装」（回退），当前版本不可点。桌面版走应用内下载 + 校验 + 替换 + 重启；网页端只能「下载」安装包（无 IPC，无法替换 exe）。回退后仍会提示升级。
- **覆盖范围**：仅 **Electron 打包版**支持一键更新（应用内下载 → 进度条 → SHA256 校验 → 退出并由 runner 替换 exe → 重启）；Vue3 网页端只显示检查与版本历史；旧版 `public/` 无入口。
- **降级**：`PORTABLE_EXECUTABLE_FILE` 缺失 / 目录只读 / 校验失败时，退回到「已下载，请完全退出程序后手动替换」。更新前请关闭所有 KafkaDesk 实例（有单实例锁）。

## 发版

**双击仓库根目录的 `release.bat`**（或命令行 `release.bat`），按提示选 `patch / minor / major / custom`，脚本会自动完成：

1. `verify:update` 离线自检；
2. 版本 bump 并同步 4 处（根 `package.json`、根 `package-lock.json`、`web/package.json`、`web/package-lock.json`）；
3. 构建 `web/dist` + `KafkaDesk-X.Y.Z-portable.exe`；
4. 生成 `.sha256` 资产；
5. `git add -A` → commit → tag → push；
6. `gh release create` 上传 exe + sha256（自动生成 Release Notes）。

> **不要手动改 `package.json` 的 version**：脚本是唯一入口，手改会破坏「四处一致」校验。
> `release` 脚本在**仓库根目录**，不要在 `web/` 下执行（会报 `Missing script: "release"`）。

版本号怎么选（语义化版本）：

| 改动类型 | 选项 | 例子 |
|---|---|---|
| 修 bug / 文案 / 样式微调 | `patch` | 1.0.1 → 1.0.2 |
| 新功能、接口兼容 | `minor` | 1.0.1 → 1.1.0 |
| 不兼容变更（换协议/删接口） | `major` | 1.0.1 → 2.0.0 |
| 精确指定 | `custom`（选 4 后输入） | 输入 `1.1.0` |

**手动指定精确版本**（必须大于当前版本，且 tag 不能已存在，否则拒绝）：

```bash
release.bat                         # 交互式，选 4 后输入版本号
npm run release -- --version 1.1.0 --publish
npm run release -- 1.1.0 --publish  # 位置参数写法，等价
```

其他命令：

```bash
release.bat --dry-run patch    # 只预演，不写文件、不推送
release.bat --dry-run 1.1.0    # 预演精确版本
npm run release -- baseline    # 仅首次基线用（当前已发过 v1.0.0，之后不要再用）
```

`.sha256` 资产必须与 exe 一起上传，否则客户端会拒绝替换（脚本已处理）。

### 人工验证清单（不可离线自动化）

| # | 动作 |
|---|---|
| 1 | 运行打包 exe，确认 `%APPDATA%/kafka-desk/portable-probe.json` 的 `target` 是外层 exe、`execPath` 是临时副本 |
| 2 | 联网打开设置 → 关于，确认检查更新、版本历史、限流降级文案 |
| 3 | 用测试 tag 做一次真实一键更新，观察进度条 → 校验 → 退出重启 |
| 4 | 验证 SmartScreen 提示 / 只读目录 / 断网 三个降级场景 |

## 数据与缓存

- 服务器注册表：`data/registry.json`（Electron 打包版在 `%APPDATA%/KafkaDesk/data`）；
- 前端 localStorage 键均带 `kafka-desk-` 前缀（主题 / 偏好 / 草稿 / 消息缓存 / 自动化设置），设置页「本地数据」可一键清理；
- 消息缓存条数、接收区上限在 设置 → 消息与缓存 中调整，实时生效。

## 目录速览

```
server.js          # 全部后端逻辑（KafkaJS + SSE + 静态托管）
electron/main.js   # 桌面壳：进程内起 server.js，窗口指向本机 URL
public/            # 旧版前端（保留为回退路径）
web/               # Vue3 前端（src/ 源码 + dist/ 构建产物）
tools/             # 自检脚本
docs/              # 改造规划文档
start.bat          # 网页端一键启动
```
