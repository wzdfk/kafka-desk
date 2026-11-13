/* 版本更新功能离线自检（Q11 L2）。不联网、不启动 GUI、绝不碰真实 exe。
 * 覆盖：版本一致性 / 注入链路 / IPC 契约 / 校验与白名单 / 降级判定 /
 * runner 在临时目录的「替换 + 回滚」沙盒演练 / 打包态探针（存在则校验）。
 * 用法：npm run verify:update
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  sha256File, parseChecksum, isTrustedDownload, resolveTarget, buildRunnerScript,
} = require('../electron/update');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  (${extra})`}`);
}
const read = (f) => (fs.existsSync(path.join(ROOT, f))
  ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '');
const json = (f) => JSON.parse(read(f));

function versions() {
  const pkgs = ['package.json', 'web/package.json'].map((f) => json(f).version);
  const locks = ['package-lock.json', 'web/package-lock.json'].flatMap((f) => {
    const j = json(f);
    return [j.version, j.packages[''].version];
  });
  return [...pkgs, ...locks];
}

function runScript(script, dir) {
  const file = path.join(dir, `runner-${Date.now()}-${Math.random().toString(36).slice(2)}.cmd`);
  fs.writeFileSync(file, script, 'utf8');
  const r = spawnSync('cmd.exe', ['/c', file], { cwd: dir, encoding: 'utf8', windowsHide: true });
  return { file, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
}

function main() {
  /* ---------- 版本单一事实源 ---------- */
  const vs = versions();
  check('四处版本字段一致', vs.every((v) => v === vs[0]), vs.join('/'));
  check('vite.config.js 注入 __APP_VERSION__', read('web/vite.config.js').includes('__APP_VERSION__'));
  check('Settings.vue 不再硬编码版本', !/APP_VERSION\s*=\s*'1\.0\.0'/.test(read('web/src/views/Settings.vue')));
  check('UpdateManager 使用注入版本', read('web/src/components/UpdateManager.vue').includes('__APP_VERSION__'));
  check('/api/status 返回 version', /servers: registry\.length,\s*version:/.test(read('server.js')));

  const pkg = json('package.json');
  check('release 脚本已注册', pkg.scripts.release === 'node tools/release.mjs');
  check('verify:update 脚本已注册', pkg.scripts['verify:update'] === 'node tools/verify-update.js');
  check('打包包含 electron/**/*（preload 与 update.js）', (pkg.build.files || []).includes('electron/**/*'));

  /* ---------- 桌面桥接契约 ---------- */
  const preload = read('electron/preload.js');
  check('preload 暴露 isDesktop / download / cancel / apply / onProgress',
    ['isDesktop', 'download:', 'cancel:', 'apply:', 'onProgress'].every((k) => preload.includes(k)));
  const mainSrc = read('electron/main.js');
  check('main.js 挂载 preload', mainSrc.includes("preload: path.join(__dirname, 'preload.js')"));
  check('main.js 注册四个 IPC handler',
    ['update:capabilities', 'update:download', 'update:cancel', 'update:apply']
      .every((k) => mainSrc.includes(`'${k}'`)));
  check('main.js 使用 PORTABLE_EXECUTABLE_FILE 探针',
    mainSrc.includes('PORTABLE_EXECUTABLE_FILE') && mainSrc.includes('writePortableProbe'));

  /* ---------- 纯逻辑：白名单 / 校验 / 降级 ---------- */
  const good = 'https://github.com/wzdfk/kafka-desk/releases/download/v1.0.1/KafkaDesk-1.0.1-portable.exe';
  check('下载 URL 白名单接受官方直链', isTrustedDownload(good));
  check('下载 URL 白名单拒绝外域 / http / 其他仓库',
    !isTrustedDownload('https://evil.example/x.exe')
    && !isTrustedDownload(good.replace('https:', 'http:'))
    && !isTrustedDownload(good.replace('wzdfk/kafka-desk', 'other/repo')));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kafkadesk-vu-'));
  const probeFile = path.join(tmp, 'sample.bin');
  fs.writeFileSync(probeFile, 'kafkadesk-update-check');
  const hash = sha256File(probeFile);
  check('sha256File 与 parseChecksum 配套', parseChecksum(`${hash}  KafkaDesk-1.0.1-portable.exe\n`) === hash
    && parseChecksum('not-a-hash') === null);

  const dummyTarget = path.join(tmp, 'KafkaDesk-1.0.0-portable.exe');
  fs.writeFileSync(dummyTarget, 'OLD');
  check('resolveTarget：开发态降级', resolveTarget({ isPackaged: false, env: {} }).reason === 'dev-mode');
  check('resolveTarget：变量缺失降级', resolveTarget({ env: {} }).reason === 'no-portable-target');
  check('resolveTarget：目标不存在降级',
    resolveTarget({ env: { PORTABLE_EXECUTABLE_FILE: path.join(tmp, 'missing.exe') } }).reason === 'target-missing');
  check('resolveTarget：正常解析到外层 exe',
    resolveTarget({ env: { PORTABLE_EXECUTABLE_FILE: dummyTarget } }).target === dummyTarget);
  const roFs = Object.create(fs); // 继承 existsSync / constants，仅覆盖 accessSync
  roFs.accessSync = () => { throw new Error('EACCES'); };
  check('resolveTarget：只读目录降级',
    resolveTarget({ env: { PORTABLE_EXECUTABLE_FILE: dummyTarget }, fsImpl: roFs }).reason === 'readonly-dir');

  /* ---------- runner 沙盒：成功替换 ---------- */
  const oldFile = path.join(tmp, 'sandbox-old.exe');
  const staged = path.join(tmp, 'sandbox-new.exe');
  const backup = path.join(tmp, 'sandbox-old.previous.exe');
  const marker = path.join(tmp, 'launched.flag');
  const result = path.join(tmp, 'runner.result');
  fs.writeFileSync(oldFile, 'OLD');
  fs.writeFileSync(staged, 'NEW');
  const okScript = buildRunnerScript({
    target: oldFile, staged, backup, resultFile: result,
    launch: `> "${marker}" echo launched`, maxWait: 2,
  });
  const okRun = runScript(okScript, tmp);
  check('runner 成功替换外层 exe', fs.readFileSync(oldFile, 'utf8') === 'NEW', okRun.output.slice(0, 120));
  check('runner 写成功结果并触发启动标记',
    fs.readFileSync(result, 'utf8').trim() === 'ok' && fs.existsSync(marker));
  check('runner 成功后清理备份', !fs.existsSync(backup));

  /* ---------- runner 沙盒：新包缺失时回滚 ---------- */
  fs.writeFileSync(oldFile, 'OLD2');
  fs.writeFileSync(result, '');
  const badScript = buildRunnerScript({
    target: oldFile, staged: path.join(tmp, 'not-downloaded.exe'),
    backup, resultFile: result, launch: 'echo noop', maxWait: 2,
  });
  const badRun = runScript(badScript, tmp);
  check('runner 失败时回滚旧 exe', fs.readFileSync(oldFile, 'utf8') === 'OLD2', badRun.output.slice(0, 120));
  check('runner 写 rollback 结果', fs.readFileSync(result, 'utf8').trim() === 'rollback');

  /* ---------- 发版脚本 dry-run ---------- */
  // 直接跑脚本本身：绕开 npm.cmd 在 Node 24 下 spawnSync 的 EINVAL，也避免 shell 警告。
  const dry = spawnSync(process.execPath, ['tools/release.mjs', 'baseline', '--dry-run'],
    { cwd: ROOT, encoding: 'utf8' });
  check('release.mjs dry-run 通过', dry.status === 0 && /版本一致性 OK/.test(dry.stdout || ''),
    String(dry.stderr || dry.stdout || '').slice(-160));

  /* ---------- 打包态探针（可选，需人工跑过一次 exe） ---------- */
  const probePath = path.join(process.env.APPDATA || '', 'kafka-desk', 'portable-probe.json');
  if (fs.existsSync(probePath)) {
    const p = JSON.parse(fs.readFileSync(probePath, 'utf8'));
    check('探针确认外层 exe 与 execPath 不同', !!p.target && p.target !== p.execPath, p.target || '');
    check('探针指向的 exe 存在', fs.existsSync(p.target));
  } else {
    console.log('SKIP  打包态探针（尚未运行过带探针的 exe）');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main();
