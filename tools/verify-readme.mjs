import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readmePath = new URL('../README.md', import.meta.url);
const licensePath = new URL('../LICENSE', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);

assert.ok(existsSync(readmePath), '缺少 README.md');
assert.ok(existsSync(licensePath), '缺少 LICENSE');

const readme = readFileSync(readmePath, 'utf8');
const license = readFileSync(licensePath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

const requiredHeadings = [
  '## 特性',
  '## 快速开始',
  '## 配置与数据',
  '## 项目结构',
  '## 开发与测试',
  '## 常见问题',
  '## 贡献',
  '## 交流沟通',
  '## 许可证',
];

for (const heading of requiredHeadings) {
  assert.ok(readme.includes(heading), `README 缺少章节：${heading}`);
}

assert.ok(readme.includes('1302407033@qq.com'), 'README 缺少联系邮箱');
assert.ok(readme.includes('https://github.com/wzdfk/kafka-desk/issues'), 'README 缺少 Issues 链接');
assert.ok(readme.includes('MIT License') && readme.includes('./LICENSE'), 'README 缺少 MIT 说明或 LICENSE 链接');
assert.ok(readme.includes(`version-${pkg.version}`), `README 版本徽章与 package.json 不一致：${pkg.version}`);

assert.ok(license.startsWith('MIT License'), 'LICENSE 不是 MIT 格式');
assert.ok(license.includes('Permission is hereby granted'), 'LICENSE 缺少 MIT 授权条款');
assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'LICENSE 缺少 MIT 免责声明');

console.log('README 验证通过：章节、联系方式、MIT 说明、LICENSE 与版本号均正常。');
