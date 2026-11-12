/* T9 集成切换自检（启动真实 server.js，无需 GUI / Kafka）：
 * 1) KAFKA_DESK_STATIC=web/dist  → 首页为 Vue3 构建产物（module script + assets）；
 * 2) 未设置该变量                → 仍返回旧版 public/（start.bat 路径不变）；
 * 3) 指向不存在的目录            → 回退 public/（旧版回退路径验证）；
 * 4) 打包配置 / 主进程注入 / server.js 回退逻辑三处配置齐全。
 * 每个场景独立端口 + 独立临时数据目录，不触碰 <repo>/data。
 * 用法：npm run verify:integration
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

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

async function waitReady(port, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await get(port, '/api/status');
      if (r.status === 200) return r;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`端口 ${port} 的 server.js 未在超时内就绪`);
}

function startServerEnv(extraEnv, port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kafkadesk-int-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      KAFKA_DESK_PORT: String(port),
      KAFKA_DESK_DATA: tmp,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += String(c); });
  return { child, tmp, getErrText: () => stderr };
}

async function withServer(extraEnv, port, fn) {
  const { child, tmp, getErrText } = startServerEnv(extraEnv, port);
  try {
    await waitReady(port);
    await fn(getErrText);
  } finally {
    if (typeof child.kill === 'function') child.kill();
    await new Promise((r) => setTimeout(r, 150));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  /* ---------------- 场景 1：指向 web/dist（Vue3 版） ---------------- */
  await withServer({ KAFKA_DESK_STATIC: path.join(ROOT, 'web', 'dist') }, 18801, async () => {
    const page = await get(18801, '/');
    check('KAFKA_DESK_STATIC=web/dist → 首页 200', page.status === 200);
    check('首页为 Vue3 构建（module script）', page.body.includes('type="module"') && page.body.includes('/assets/'));
    check('旧版特征不在 Vue3 首页', !page.body.includes('styles.css'));
    const assetRef = (page.body.match(/src="([^"]*\/assets\/[^"]+\.js)"/) || [])[1];
    if (assetRef) {
      const asset = await get(18801, assetRef.startsWith('/') ? assetRef : `/${assetRef}`);
      check('构建产物 JS 可访问', asset.status === 200 && asset.body.length > 1000);
    } else {
      check('构建产物 JS 可访问', false, '首页未找到 assets JS 引用');
    }
    const fav = await get(18801, '/favicon.ico');
    check('favicon 经 dist 可访问', fav.status === 200);
  });

  /* ---------------- 场景 2：默认（旧版 public/） ---------------- */
  await withServer({}, 18802, async () => {
    const page = await get(18802, '/');
    check('默认目录仍为旧版 public/', page.status === 200
      && page.body.includes('styles.css') && !page.body.includes('type="module"'));
  });

  /* ---------------- 场景 3：目录缺失 → 回退 public/ ---------------- */
  const bogus = path.join(os.tmpdir(), 'kafkadesk-no-such-front');
  let warned = false;
  await withServer({ KAFKA_DESK_STATIC: bogus }, 18803, async (getErrText) => {
    const page = await get(18803, '/');
    check('静态目录缺失 → 回退旧版 public/', page.status === 200
      && page.body.includes('styles.css') && !page.body.includes('type="module"'));
    warned = getErrText().includes('回退');
    check('回退时打印 WARN 日志', warned);
  });

  /* ---------------- 场景 4：三处配置齐全 ---------------- */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('打包 files 含 web/dist/**/*', (pkg.build.files || []).includes('web/dist/**/*'));
  const mainSrc = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  check('Electron 主进程注入 KAFKA_DESK_STATIC', mainSrc.includes('KAFKA_DESK_STATIC'));
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check('server.js 含静态目录选择与回退逻辑', serverSrc.includes('KAFKA_DESK_STATIC') && serverSrc.includes('回退'));
  check('dist 脚本前置 vite 构建', typeof pkg.scripts.predist === 'string' && pkg.scripts.predist.includes('web'));
  check('web/dist 产物已存在', fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html')));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL  验证过程异常:', err);
  process.exitCode = 1;
});
