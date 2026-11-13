/* Electron 打包改造自检（无需启动 GUI）：
 * 1) server.js 能否以「动态端口 + 自定义数据目录」启动并被 /api/status 访问；
 * 2) 打包后必读的文件是否齐全（入口、图标、前端静态资源）；
 * 3) 主进程安全配置是否关闭了 nodeIntegration。
 * 用法：node tools/verify-electron.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  (${extra})`}`);
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

function icoHas256(file) {
  const b = fs.readFileSync(file);
  const count = b.readUInt16LE(4);
  for (let i = 0; i < count; i += 1) {
    const w = b.readUInt8(6 + i * 16) || 256;
    if (w === 256) return true;
  }
  return false;
}

async function main() {
  /* ---------------- 后端可注入启动 ---------------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kafkadesk-'));
  process.env.KAFKA_DESK_DATA = tmp;
  delete require.cache[require.resolve(path.join(ROOT, 'server.js'))];
  const { startServer } = require(path.join(ROOT, 'server.js'));

  const { server, port, url } = await startServer({ port: 0 });
  check('server.js 支持动态端口启动', port > 0, `url=${url}`);
  check('server.js 导出 startServer', typeof startServer === 'function');

  const status = await get(port, '/api/status');
  check('/api/status 返回 ok', status.status === 200 && status.body.includes('"ok":true'), status.body.slice(0, 80));

  const page = await get(port, '/');
  check('静态首页可访问', page.status === 200 && page.body.includes('KafkaDesk'));

  const sseType = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, (res) => {
      resolve({ status: res.statusCode, type: String(res.headers['content-type'] || '') });
      res.destroy();
      req.destroy();
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, type: '' }); });
  });
  check('SSE 端点返回 event-stream', sseType.status === 200 && sseType.type.includes('text/event-stream'), sseType.type);

  check('数据目录落在注入路径', path.resolve(process.env.KAFKA_DESK_DATA) === path.resolve(tmp));

  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });

  /* ---------------- 打包产物必需项 ---------------- */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('main 指向 electron 主进程', pkg.main === 'electron/main.js', String(pkg.main));
  check('主进程文件存在', fs.existsSync(path.join(ROOT, pkg.main)));

  const build = pkg.build || {};
  const files = build.files || [];
  check('打包包含 server.js', files.includes('server.js'));
  check('打包包含 public/**/*', files.includes('public/**/*'));
  check('打包排除 data/**（避免写入只读 asar）', files.includes('!data/**'));
  check('win 目标为 portable', JSON.stringify(build.win && build.win.target).includes('portable'));
  check('图标含 256x256', icoHas256(path.join(ROOT, build.win.icon)), build.win.icon);

  const mainSrc = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  check('nodeIntegration 关闭', /nodeIntegration:\s*false/.test(mainSrc));
  check('contextIsolation 开启', /contextIsolation:\s*true/.test(mainSrc));
  check('数据目录指向 userData', mainSrc.includes("app.getPath('userData')"));
  check('单实例锁已启用', mainSrc.includes('requestSingleInstanceLock'));
  check('更新桥接：preload.js 存在且被挂载',
    fs.existsSync(path.join(ROOT, 'electron/preload.js'))
    && mainSrc.includes("preload: path.join(__dirname, 'preload.js')"));
  check('更新逻辑：electron/update.js 存在且被引用',
    fs.existsSync(path.join(ROOT, 'electron/update.js'))
    && mainSrc.includes("require('./update')"));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL  验证过程异常:', err);
  process.exitCode = 1;
});
