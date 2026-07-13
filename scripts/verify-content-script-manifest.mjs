import { readFile } from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('缺少构建目标目录');

const manifestPath = new URL(`../.output/${target}/manifest.json`, import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const matches = manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];
const expected = ['*://*.bilibili.com/*', '*://*.youtube.com/*'];

if (JSON.stringify(matches) !== JSON.stringify(expected)) {
  throw new Error(`静态内容脚本匹配范围异常：${JSON.stringify(matches)}`);
}
