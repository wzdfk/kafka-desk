/* Vue3 前端（web/）快速自检：
 * 1) 关键源文件齐全；
 * 2) node --test 单测通过（storage / api 协议）；
 * 3) vite build 产物存在且包含防闪脚本与挂载点。
 * 用法：npm run verify:web  （或 node tools/verify-web.js）
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  (${extra})`}`);
}

const SRC_FILES = [
  'src/main.js', 'src/App.vue', 'src/styles/base.css', 'src/theme/index.js', 'src/theme/overrides.js',
  'src/api/api.js', 'src/api/sse.js', 'src/utils/storage.js', 'src/utils/toast.js', 'src/utils/dialog.js',
  'src/utils/releases.js',
  'src/stores/servers.js', 'src/stores/prefs.js', 'src/stores/syslog.js', 'src/stores/active.js',
  'src/stores/messages.js', 'src/stores/automation.js',
  'src/router/index.js', 'src/components/TopBar.vue', 'src/components/IconBtn.vue',
  'src/components/StatusBadge.vue', 'src/components/ServerModal.vue',
  'src/components/AccordionSection.vue', 'src/components/ConfigPanel.vue', 'src/components/RunLogPanel.vue',
  'src/components/SendPanel.vue', 'src/components/ReceiveArea.vue', 'src/components/MessageCard.vue',
  'src/components/TopicFilterPanel.vue', 'src/components/Splitter.vue', 'src/components/AutoTestModal.vue',
  'src/components/UpdateManager.vue',
  'src/views/ServerList.vue', 'src/views/Workspace.vue', 'src/views/Settings.vue',
];

function main() {
  check('web/ 工程存在', fs.existsSync(path.join(WEB, 'package.json')));

  let missing = SRC_FILES.filter((f) => !fs.existsSync(path.join(WEB, f)));
  check(`关键源文件齐全（${SRC_FILES.length} 个）`, missing.length === 0, missing.join(', '));

  const html = fs.existsSync(path.join(WEB, 'index.html'))
    ? fs.readFileSync(path.join(WEB, 'index.html'), 'utf8') : '';
  check('index.html 含首帧防闪脚本', html.includes('kafka-desk-theme') && html.includes('data-theme'));
  check('index.html 含挂载点 #app', html.includes('id="app"'));

  const viteCfg = fs.existsSync(path.join(WEB, 'vite.config.js'))
    ? fs.readFileSync(path.join(WEB, 'vite.config.js'), 'utf8') : '';
  check('dev 代理指向本地后端 18761', viteCfg.includes('127.0.0.1:18761'));

  console.log('\n--- node --test (web/tests) ---');
  try {
    const out = execFileSync('node', ['--test'], { cwd: WEB, encoding: 'utf8' });
    const m = out.match(/ℹ pass (\d+)/) || out.match(/pass (\d+)/);
    const f = out.match(/ℹ fail (\d+)/) || out.match(/fail (\d+)/);
    check('单元测试全部通过', f && Number(f[1]) === 0, `pass=${m ? m[1] : '?'} fail=${f ? f[1] : '?'}`);
  } catch (err) {
    check('单元测试全部通过', false, String(err.stdout || err).slice(-200));
  }

  console.log('\n--- vite build ---');
  try {
    execFileSync('npm', ['run', 'build'], { cwd: WEB, encoding: 'utf8', shell: true });
    const distIndex = path.join(WEB, 'dist', 'index.html');
    check('dist/index.html 已产出', fs.existsSync(distIndex));
    const assetsDir = path.join(WEB, 'dist', 'assets');
    const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
    check('dist/assets 含 JS 与 CSS 产物',
      assets.some((a) => a.endsWith('.js')) && assets.some((a) => a.endsWith('.css')),
      assets.join(', '));
  } catch (err) {
    check('vite build 成功', false, String(err.stdout || err).slice(-200));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main();
