# KafkaDesk Vue3 改造 · 阶段开发规划文档

> 依据：`docs/Agent_Struction.md` §2.1 生成。本文档仅做全局基线规划，不含业务实现代码。
> 状态：⏸ **待人工评审定稿**（评审通过后才能开启阶段执行）。

## 0｜输入资料（PRD 摘要）

| 编号 | 需求 | 来源 |
|---|---|---|
| R1 | UI 风格改为 Apple 风格：干净简洁、浅灰底 + 白卡片、大圆角、细分割线、SF 系字体 | 用户需求 + 参考截图 |
| R2 | UI 套件使用 Naive UI | 用户需求 |
| R3 | 保留现有主题三态切换（明亮 / 幽暗 / 跟随系统） | 用户需求 |
| R4 | 文字按钮尽量用语义匹配的 icon 图标代替 | 用户需求 |
| R5 | 组件化：页面抽成组件，公共模块可复用 | 用户需求 |
| R6 | 技术栈：Vue3 + Pinia + Vue Router（构建工具补 Vite） | 用户需求 |
| R7 | 功能范围 = 现有前端功能全量对齐（默认，见【待我确认 3】） | 推导 |

**约束（事实）**：后端 `server.js` 不改业务逻辑；`start.bat` 网页端路径保持可用；Electron 打包路径保持可用；旧版 `public/` 在切换期保留为回退。

## 1｜业务能力清单概览（迁移目标 = 现状对齐）

| 能力域 | 能力项 | 现状证据 |
|---|---|---|
| 服务器管理 | 列表卡片、添加/编辑 Broker、删除、多选项卡 | app.js:883-1045 |
| 连接与订阅 | 连接/断开双形态按钮、主题刷新/搜索/多选/自定义、单订阅/全部订阅 | app.js:1196-1414 |
| 收发消息 | JSON 编辑器（校验/字节数/格式化/示例/草稿）、发送回执、消息流渲染（合批/上限/暂停/自动滚动）、文本过滤 + 主题多选过滤、消息展开详情 | app.js:1563-2045 |
| 缓存 | per-server 消息缓存与草稿持久化、服务端 buffer 恢复、本机占用统计与清理 | app.js:394-404, 1519-1605 |
| 自动化测试 | 总数制 / 时间制、随机 request_id、进度/回执/失败熔断（连败 5 次停止） | app.js:2064-2450 |
| 系统设置 | 外观主题三选卡、消息上限 / 缓存上限、系统日志（筛选/搜索/导出/清空）、关于页 | index.html:301-512 |
| 实时通道 | SSE 4 类事件分发（status/log/kafka-messages/app-error）、断线徽章 | app.js:2446-2496 |
| 主题 | 三态 + 跟随 OS + 首帧防闪 | index.html:14-26; app.js:207-261 |

## 2｜模块依赖关系（先后顺序）

```
Vite 工程(web/) ──> 公共层 ──> Pinia stores ──> 页面组件 ──> 集成切换
                     │            │
              api.js / sse.js   servers / active / prefs / syslog
              theme.js icons
```

| 序 | 模块 | 依赖 | 说明 |
|---|---|---|---|
| M1 | 工程骨架 `web/`（Vite+Vue3+Pinia+Router+Naive UI） | 无 | hash 路由，目录见 §4 |
| M2 | 公共层：`api.js`（fetch 封装 35s 超时）、`sse.js`（EventSource 单例+分发）、`theme`（三态→Naive darkTheme+themeOverrides）、图标注册、`storage.js`（键名/防抖/瘦身） | M1 | 对齐 §1 协议 |
| M3 | stores：`servers`（列表+status 合成）、`active`（当前服务器运行态：catalog/订阅/日志/消息队列）、`prefs`、`syslog` | M2 | localStorage 命名空间沿用 `kafka-desk-*` |
| M4 | 布局壳：TopBar（选项卡/徽章/主题快捷/设置入口）+ AppLayout | M3 | Apple 风格基准在此定调 |
| M5 | 页面：`ServerList` + `ServerModal` | M4 | 阶段1 |
| M6 | 页面：`Workspace` = `ConfigPanel` / `SendPanel` / `RecvPanel`（`MessageCard` 复用） | M4 | 阶段1，含合批渲染 |
| M7 | 页面：`Settings`（外观/缓存/系统日志/关于 4 pane） | M4 | 阶段2 |
| M8 | 弹窗：`AutoTestModal`（自动化） | M6 | 阶段2 |
| M9 | 集成：`KAFKA_DESK_STATIC` 切换、Electron 打包含 `web/dist`、验证脚本 | M5-M8 | 阶段2 |

## 3｜里程碑阶段划分

### 阶段1：MVP 最小可用闭环（最高优先级）
**目标**：Vue3 版可完整完成「添加 Broker → 连接 → 订阅 → 收消息 → 发消息」主链路，Apple 风格基调成型，主题三态可用。
粗业务任务：
- T1 工程骨架 + 公共层（api/sse/theme/icons/storage）+ 布局壳
- T2 服务器列表 + Broker 增删改弹窗
- T3 配置区（主题配置/其他设置/运行日志）+ 连接断开 + 自动保存
- T4 发送区（编辑器/校验/草稿/手动发送/Ctrl+Enter）
- T5 接收区（SSE 渲染合批/上限/暂停/自动滚动/双过滤/消息详情/缓存恢复）

### 阶段2：重要增强功能
**目标**：功能与旧版完全对齐，并完成双端集成切换。
粗业务任务：
- T6 自动化测试弹窗（总数制/时间制/随机 ID/熔断/回执）
- T7 系统设置页（外观/消息与缓存/系统日志/关于）
- T8 图标化专项：全量文字按钮→语义 icon（hover 提示保留），Apple 风格精修（间距/圆角/毛玻璃顶栏/动效）
- T9 集成切换：`KAFKA_DESK_STATIC` 静态目录选择、Electron 打包含新前端、旧版回退路径验证
- T10 快速验证脚本（协议/构建/静态切换自检）

### 阶段3：次要/可选优化
- T11 性能：2000 条 pending 压测、必要时虚拟滚动
- T12 legacy localStorage 迁移（旧版无后缀键 → 新版）
- T13 文档收尾（README 启动方式更新）

> 判断依据：现状 2525 行命令式代码 + 高频渲染约束，**不属于"任务不重"**，故按模板保留三阶段；但阶段1/2 内粗任务可连续推进（每个粗任务验收时暂停一次）。

## 4｜目标目录结构（web/）

```
web/
  src/
    api/            # api.js sse.js
    stores/         # servers.js active.js prefs.js syslog.js
    theme/          # index.js(三态) overrides.js(Apple 风格 token)
    components/     # TopBar StatusBadge MessageCard TopicBar IconBtn ...
    views/          # ServerList.vue Workspace.vue Settings.vue
    router/         # index.js(hash)
    App.vue main.js
  dist/             # vite build 产物（Express/Electron 消费）
```

## 5｜风险清单

| 类型 | 风险 | 应对 |
|---|---|---|
| 技术 | SSE 高频消息下 Vue 响应式开销（旧版手写 rAF 合批 40 条/帧、pending 2000） | 消息队列放非响应式数组，rAF 批量提交 shallowRef；阶段3压测 |
| 技术 | Naive UI 默认风格与 Apple 风格有差距 | themeOverrides 全量定制 token（字体/圆角/灰阶/主色），毛玻璃顶栏自绘 |
| 集成 | 双前端并存期的静态目录切换 | `KAFKA_DESK_STATIC` 环境变量：默认 `public`（旧版/start.bat 不变），Electron 设为 `web/dist` |
| 集成 | Electron 打包需先 `vite build` | `npm run dist` 前置构建步骤，产物入 asar |
| PRD 模糊 | 见下【待我确认】 | — |

## 6｜【待我确认】清单（定稿前必须答复）

1. **图标库**：建议 `@vicons/ionicons5`（Apple 系线条风格，与 Naive UI 同源 xicons）。是否同意？
2. **旧版去留**：切换期旧版 `public/` 保留为回退（网页端 start.bat 默认仍走旧版，桌面端走新版）；阶段3 结束后是否删除旧版？
3. **功能范围**：默认全量对齐（含自动化测试、系统日志、legacy 键迁移）。若有裁剪请指出。
4. **Apple 风格基线**：浅灰背景 + 白卡片 + 12px 圆角 + 细分割线 + SF/苹方字体 + 低饱和蓝主色；暗色为深灰卡片。是否符合预期？
5. **路由**：建议沿用 hash 模式（`#/server/:id`，静态部署零配置）。是否同意？

> 评审通过后回复"确认基线 + 各待确认项答案"，即生成【阶段1 任务跟踪表】并开始执行。
