import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// 先构建两种产物，再在隔离配置目录验证。不得使用用户的浏览器配置。
const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
for (const [channel, artifact] of [
  ['chromium', 'chrome-mv3'],
  ['msedge', 'edge-mv3'],
]) {
  const manifest = JSON.parse(await readFile(`.output/${artifact}/manifest.json`, 'utf8'));
  assert.equal(manifest.version, packageInfo.version, `${artifact} 版本不一致，请重新构建`);
  assert(manifest.permissions.includes('unlimitedStorage'), `${artifact} 缺少存储保护权限`);
  execFileSync(
    process.execPath,
    ['docs/reports/storage-audit-2026-10-30/browser-restart.mjs', channel, '5'],
    { stdio: 'inherit', env: process.env },
  );
}
