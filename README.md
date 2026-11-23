# KafkaDesk

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)](./package.json)
[![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)](#快速开始)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg?logo=vue.js&logoColor=white)](./web)

KafkaDesk 是一个面向个人调试场景的轻量 Kafka 客户端。项目把 KafkaJS、Express、SSE、Vue 3 与 Electron 组合在一起，提供 Kafka 连接管理、主题订阅、消息收发、实时推送和自动化发送能力。

> 本项目定位为**个人用调试工具**，不是生产级 Kafka 管理平台。请避免在不可信网络或不具备授权的环境中使用。

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [配置与数据](#配置与数据)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [交流沟通](#交流沟通)
- [许可证](#许可证)

## 特性

| 场景 | 能力 |
|---|---|
| 多服务器管理 | 添加、编辑、删除多个 Kafka 服务器；每个服务器可配置多个 Broker |
| 连接与主题 | 连接/断开、刷新 Broker 主题、搜索与多选订阅、取消订阅、自定义主题 |
| 消息发送 | 发送合法 JSON、可选消息 Key、实时 JSON 校验与字节数统计、返回分区与 Offset 回执 |
| 实时接收 | 通过 SSE 推送消息、状态与运行日志；支持按服务器和主题过滤 |
| 自动化测试 | 支持总数制、时间制、暂停/继续/停止、随机 `request_id` 和失败熔断 |
| 桌面端 | Electron 桌面壳，内嵌后端，支持 Windows portable exe 打包 |
| 本地体验 | 亮色/暗色/跟随系统主题，草稿与本地消息缓存，运行日志与设置面板 |
| 版本更新 | 检查 GitHub Releases，下载并校验 SHA256 后更新 portable exe |

## 快速开始

### 环境要求

- Node.js 与 npm（建议使用 LTS 版本）
- 可访问的 Kafka Broker
- Windows 桌面端运行/打包需要 Windows 环境

### 启动网页端（旧版 `public/` UI）

```bat
start.bat
```

`start.bat` 会在缺少依赖时自动执行 `npm install`，启动后端 `127.0.0.1:18761`，并用 Edge/Chrome 的应用窗口打开界面。重复执行只打开新窗口，不会重启已有服务。

### 启动 Vue 3 前端

先启动后端：

```bash
npm install
npm start
```

再开一个终端启动前端：

```bash
cd web
npm install
npm run dev
```

访问 `http://localhost:5173`。Vite 会把 `/api` 代理到 `127.0.0.1:18761`，并保留 SSE 长连接。

### 启动 Electron 桌面端

```bash
npm install
npm --prefix web run build
npm run app
```

桌面端会在进程内启动后端，并使用随机端口，避免占用 `18761` 实例。

### 打包 Windows portable exe

```bash
npm run dist
```

`predist` 会自动构建 `web/dist`，产物位于 `kafka_app/KafkaDesk-1.0.1-portable.exe`。如需生成免安装目录，使用：

```bash
npm run dist:dir
```

## 使用说明

1. 在服务器配置中添加 Broker 地址。
2. 点击连接，再刷新主题列表。
3. 选择接收主题；已勾选主题会在列表中置顶。
4. 配置发送主题、消费组 `groupId` 和 `fromBeginning`。
5. 在发送区输入 JSON，可选填写 Key，使用 `Ctrl/Cmd + Enter` 发送。
6. 在接收区通过主题筛选器查看指定主题消息。
7. 需要压测时，打开自动化发送面板设置总数或持续时间。

## 配置与数据

| 数据 | 位置 | 说明 |
|---|---|---|
| 服务器配置 | `data/servers.json` | 保存 Broker、发送/接收主题、消费组等；该文件不提交仓库 |
| 服务器配置（Electron） | `app.getPath('userData')/data/servers.json` | 打包后受 asar 只读限制，写入用户数据目录 |
| 浏览器本地状态 | `localStorage` | 键名以 `kafka-desk-` 开头，包括草稿、消息缓存、主题筛选、偏好等 |
| 服务端消息缓冲 | 内存 | 每个服务器最多保留 200 条，不写入磁盘 |
| 更新包 | `app.getPath('userData')/updates` | 桌面端下载与校验后的更新文件 |

环境变量：

| 变量 | 用途 |
|---|---|
| `KAFKA_DESK_HOST` | 后端监听地址，默认 `127.0.0.1` |
| `KAFKA_DESK_PORT` | 后端端口，默认 `18761` |
| `KAFKA_DESK_DEMO` | 设置为 `1` 时启用演示消息 |
| `KAFKA_DESK_DATA` | 覆盖服务端数据目录 |
| `KAFKA_DESK_STATIC` | 覆盖静态资源目录 |
| `KAFKA_DESK_DEVTOOLS` | 开发桌面端时启用 DevTools |

## 项目结构

```text
server.js          后端入口：KafkaJS、REST API、SSE、静态托管
lib/               GitHub Releases Atom Feed 解析
public/            旧版前端，同时作为 Vue3 产物缺失时的回退界面
web/               Vue 3 前端源码、单元测试与构建产物
electron/          Electron 主进程、IPC 预加载与更新逻辑
data/              本地服务器配置（不提交）
tools/             发版脚本与图标生成脚本
start.bat          网页端一键启动器
release.bat        GitHub Release 发布助手
```

## 开发与测试

| 操作 | 命令 |
|---|---|
| 安装根依赖 | `npm install` |
| 安装前端依赖 | `cd web && npm install` |
| 启动后端 | `npm start` |
| 启动前端开发服务器 | `cd web && npm run dev` |
| 运行前端测试 | `cd web && npm test` |
| 构建前端 | `npm --prefix web run build` |
| 启动桌面端 | `npm run app` |
| 打包 portable exe | `npm run dist` |
| 打包目录 | `npm run dist:dir` |
| 生成图标 | `node tools/make-icons.js` |
| 发布版本 | `npm run release -- patch`，或使用 `release.bat` |

版本统一以根 `package.json` 为事实源；发布流程可参考 `tools/release.mjs`。

## 常见问题

**Q：Vue 3 页面请求 `/api` 失败？**

先确认后端已通过 `npm start` 启动，且端口为 `18761`。

**Q：Electron 打开后白屏？**

先执行 `npm --prefix web run build`，确认 `web/dist` 存在后再运行 `npm run app`。

**Q：刷新主题列表为空？**

检查 Broker 地址、网络连通性与 ACL 权限；也可以直接在“自定义主题”中手动添加。

**Q：配置保存在哪里？**

网页端保存在 `data/servers.json`；Electron 打包后保存在用户数据目录。浏览器草稿与缓存保存在 `localStorage`。

## 贡献

欢迎通过 Issue 或 Pull Request 改进本项目。建议流程：

1. Fork 仓库并创建分支，例如 `feat/topic-order`。
2. 保持改动聚焦，避免提交本地 `data/servers.json` 或构建产物。
3. 修改前端逻辑时运行 `cd web && npm test`。
4. 在 PR 中说明问题背景、改动点、验证方式和回滚方式。

## 交流沟通

- GitHub Issues：<https://github.com/wzdfk/kafka-desk/issues>
- 联系邮箱：<1302407033@qq.com>

反馈问题时建议附上：Kafka 版本、Broker 配置摘要、复现步骤、相关运行日志，以及使用的是网页端还是 Electron 桌面端。

## 许可证

本项目使用 [MIT License](./LICENSE) 开源。

你可以自由使用、复制、修改、合并、发布、分发、再许可和/或销售本软件副本，但必须在所有副本或重要部分中保留版权声明和许可声明。软件按“原样”提供，不作任何明示或暗示担保，包括但不限于适销性、特定用途适用性和不侵权责任。完整条款见 [LICENSE](./LICENSE)。
