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
cd web
npm install
npm run dev    # http://localhost:5173，/api 代理到 127.0.0.1:18761（需先启动后端）
npm test       # node --test 单元测试
npm run build  # 产出 web/dist
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
