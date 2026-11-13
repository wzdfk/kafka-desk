'use strict';

/* portable 自更新辅助逻辑（Q7'=A' / Q8=A）。
 * 纯函数与 runner 模板单独成文件，便于 tools/verify-update.js 在临时目录沙盒演练。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'wzdfk/kafka-desk';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseChecksum(text) {
  const m = /^([a-f0-9]{64})(?:\s|$)/i.exec(String(text || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/* 仅放行本仓库 release 资产的 HTTPS 下载直链（Q7 安全约束）。 */
function isTrustedDownload(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && u.hostname === 'github.com'
      && u.pathname.startsWith(`/${REPO}/releases/download/`);
  } catch {
    return false;
  }
}

/* 更新目标只能是 portable 启动器注入的外层 exe；拿不到就降级（Q8 硬兜底）。 */
function resolveTarget({ env = process.env, isPackaged = true, fsImpl = fs, pathImpl = path } = {}) {
  if (!isPackaged) return { ok: false, reason: 'dev-mode' };
  const target = env.PORTABLE_EXECUTABLE_FILE;
  if (!target) return { ok: false, reason: 'no-portable-target' };
  if (!fsImpl.existsSync(target)) return { ok: false, reason: 'target-missing' };
  try {
    fsImpl.accessSync(pathImpl.dirname(target), fsImpl.constants.W_OK);
  } catch {
    return { ok: false, reason: 'readonly-dir' };
  }
  return { ok: true, target };
}

/* 生成临时 .cmd runner：
 * 1) 循环尝试把旧 exe 改名为 .previous.exe（成功即代表文件锁已释放）；
 * 2) 把新 exe 移到旧路径，失败则从备份回滚；
 * 3) 启动新 exe（沙盒里可替换成写标记文件，绝不启动 GUI）；
 * 4) 写结果文件供自检断言，最后自删。 */
function buildRunnerScript({
  target, staged, backup, resultFile = '', launch = '', maxWait = 30,
}) {
  const q = (v) => String(v || '').replace(/"/g, '');
  const start = launch || `start "" "${q(target)}"`;
  const result = resultFile || path.join(path.dirname(String(staged)), 'kafkadesk-runner.result');
  return [
    '@echo off',
    'setlocal',
    `set "OLD=${q(target)}"`,
    `set "NEW=${q(staged)}"`,
    `set "BAK=${q(backup)}"`,
    `set "RES=${q(result)}"`,
    `set /a n=0`,
    ':wait',
    'move /Y "%OLD%" "%BAK%" >nul 2>&1',
    'if not errorlevel 1 goto replaced',
    'set /a n+=1',
    `if %n% GEQ ${maxWait} goto fail`,
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':replaced',
    'move /Y "%NEW%" "%OLD%" >nul 2>&1',
    'if errorlevel 1 goto rollback',
    start,
    '> "%RES%" echo ok',
    'del "%BAK%" >nul 2>&1',
    'del "%~f0" >nul 2>&1',
    'exit /b 0',
    ':rollback',
    'move /Y "%BAK%" "%OLD%" >nul 2>&1',
    '> "%RES%" echo rollback',
    'del "%~f0" >nul 2>&1',
    'exit /b 1',
    ':fail',
    '> "%RES%" echo fail',
    'del "%~f0" >nul 2>&1',
    'exit /b 2',
  ].join('\r\n') + '\r\n';
}

module.exports = {
  REPO, sha256File, parseChecksum, isTrustedDownload, resolveTarget, buildRunnerScript,
};
