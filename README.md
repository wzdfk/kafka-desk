# KafkaDesk · 个人用简易 Kafka 客户端

Kafka 收发与订阅调试工具：Express 后端（`server.js`，SSE 推送）+ Vue前端 （Vue3 + Naive UI + Pinia，Apple 风格）+ Electron桌面端。

## 启动方式

| 方式 | 命令 | 前端 | 说明 |
|---|---|---|---|
| 网页端 | 双击 `start.bat` | 旧版 `public/` | 端口 18761，自动装依赖、拉起浏览器 `--app` 窗口；重复执行只开新窗口不重启服务 |
| 网页端（Vue3 版） | npm start; cd web + npm run dev | 构建: npm run build 输出`web/dist` |  |
| Electron端| `npm run app` | 打开桌面端 | 随机端口，不影响 18761 实例；需要先构建dist; 打包:npm run dist |
| 打包 portable exe | `npm run dist` | 


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

## 目录速览

```
server.js          # 全部后端逻辑（KafkaJS + SSE + 静态托管）
electron/main.js   # 桌面壳：进程内起 server.js，窗口指向本机 URL
public/            # 旧版前端（保留为回退路径）
web/               # Vue3 前端（src/ 源码 + dist/ 构建产物）
start.bat          # 网页端一键启动
```
