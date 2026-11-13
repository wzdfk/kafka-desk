/* KafkaDesk 发版脚本（Q4=A / Q3 版本镜像修正 / Q8 .sha256 资产）。
 *
 *   npm run release -- baseline            # 首个基线 Release（不 bump 版本）
 *   npm run release -- patch|minor|major   # bump + 构建 + 产物 + 输出发布命令
 *   npm run release -- patch --publish     # 额外自动 commit/tag/push + gh release create
 *   npm run release -- patch --dry-run     # 只做一致性检查并打印计划，不写文件
 *
 * 根 package.json 是唯一版本事实源；web/package.json 与两个 lock 是派生镜像。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.find((a) => ['baseline', 'patch', 'minor', 'major'].includes(a)) || 'baseline';
const publish = args.includes('--publish');
const dryRun = args.includes('--dry-run');

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const writeJson = (f, obj) => {
  if (dryRun) return;
  fs.writeFileSync(path.join(ROOT, f), `${JSON.stringify(obj, null, 2)}\n`);
};
const run = (cmd) => {
  console.log(`> ${cmd}`);
  if (dryRun) return '';
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
};

function bump(v, kind) {
  const [a, b, c] = v.split('.').map(Number);
  if (kind === 'major') return `${a + 1}.0.0`;
  if (kind === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

function assertConsistent() {
  const root = readJson('package.json');
  const web = readJson('web/package.json');
  const lock = readJson('package-lock.json');
  const webLock = readJson('web/package-lock.json');
  const values = [root.version, web.version, lock.version, lock.packages[''].version,
    webLock.version, webLock.packages[''].version];
  if (values.some((v) => v !== root.version)) {
    throw new Error(`版本不一致：${values.join(' / ')}`);
  }
  return root.version;
}

function main() {
  const current = assertConsistent();
  const version = mode === 'baseline' ? current : bump(current, mode);
  const tag = `v${version}`;
  const exe = path.join(ROOT, 'kafka_app', `KafkaDesk-${version}-portable.exe`);
  const sumFile = `${exe}.sha256`;

  console.log(`版本一致性 OK：${current} → ${version}（${mode}）`);
  console.log(`产物：${path.relative(ROOT, exe)}`);

  if (mode !== 'baseline' && !dryRun) {
    const root = readJson('package.json');
    const web = readJson('web/package.json');
    const lock = readJson('package-lock.json');
    const webLock = readJson('web/package-lock.json');
    root.version = web.version = lock.version = webLock.version = version;
    lock.packages[''].version = webLock.packages[''].version = version;
    writeJson('package.json', root);
    writeJson('web/package.json', web);
    writeJson('package-lock.json', lock);
    writeJson('web/package-lock.json', webLock);
  }

  if (!fs.existsSync(exe) || mode !== 'baseline') {
    run('npm run dist'); // predist 自动构建 web/dist
  }
  if (!dryRun) {
    if (!fs.existsSync(exe)) throw new Error(`未找到产物：${exe}`);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    fs.writeFileSync(sumFile, `${hash}  KafkaDesk-${version}-portable.exe\n`);
    console.log(`SHA256：${hash}`);
  }

  const cmds = [
    `git add -A`, // 发版 tag 必须包含全部功能改动，不能只提交版本文件
    `git commit -m "release: ${tag}"`,
    `git tag ${tag}`,
    `git push && git push origin ${tag}`,
    `gh release create ${tag} kafka_app/KafkaDesk-${version}-portable.exe kafka_app/KafkaDesk-${version}-portable.exe.sha256 --generate-notes --title "${tag}"`,
  ];

  if (publish && !dryRun) {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    if (!dirty.trim()) console.log('工作区无改动，跳过 commit');
    else cmds.slice(0, 2).forEach(run);
    cmds.slice(2).forEach(run);
  } else {
    console.log('\n下一步（手动执行，或加 --publish 自动执行）：');
    cmds.forEach((c) => console.log(`  ${c}`));
  }
  console.log(`\n${dryRun ? 'DRY-RUN 完成，未写任何文件' : '本地产物准备完成'}`);
}

main();
