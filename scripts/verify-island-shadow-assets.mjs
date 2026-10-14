import { readFile, readdir, stat } from 'node:fs/promises';

/**
 * M4 Shadow DOM 字体/样式产物校验（工单 #43）。
 *
 * 输入：构建产物目录名（chrome-mv3 / edge-mv3）。断言：
 * - 9 个本地 woff2 字体按库内相对路径 files/ 复制进产物（独立文件、非 base64 内联）；
 * - 内容脚本内联的库 CSS 保留 files/ 相对字体路径，且没有远程字体引用；
 * - web_accessible_resources 只对内容脚本支持站点开放字体文件。
 */

const target = process.argv[2];
if (!target) throw new Error('缺少构建目标目录');

const outDir = new URL(`../.output/${target}/`, import.meta.url);
const expectedFontCount = 9;

const fontFiles = (await readdir(new URL('files/', outDir))).filter((name) =>
  name.endsWith('.woff2'),
);
if (fontFiles.length !== expectedFontCount) {
  throw new Error(`字体文件数量异常：${fontFiles.length}（期望 ${expectedFontCount}）`);
}
let totalFontBytes = 0;
for (const name of fontFiles) {
  totalFontBytes += (await stat(new URL(`files/${name}`, outDir))).size;
}
if (totalFontBytes < 3_000_000) {
  throw new Error(`字体总大小异常：${totalFontBytes} B（期望不小于 3 MB）`);
}

const contentScript = await readFile(new URL('content-scripts/content.js', outDir), 'utf8');
if (!contentScript.includes('files/nunito-latin-500-normal.78b3b3a4.woff2')) {
  throw new Error('内容脚本未内联库 CSS 的 files/ 相对字体路径');
}
if (/data:font\//.test(contentScript)) {
  throw new Error('内容脚本出现 base64 内联字体：字体应保持独立文件');
}
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(contentScript)) {
  throw new Error('内容脚本出现远程字体引用');
}

const manifest = JSON.parse(await readFile(new URL('manifest.json', outDir), 'utf8'));
const fontEntry = (manifest.web_accessible_resources ?? []).find((entry) =>
  (entry.resources ?? []).includes('files/*.woff2'),
);
if (!fontEntry) {
  throw new Error('manifest 未声明 files/*.woff2 的 web_accessible_resources');
}
const expectedMatches = ['*://*.bilibili.com/*', '*://*.youtube.com/*'];
if (JSON.stringify(fontEntry.matches) !== JSON.stringify(expectedMatches)) {
  throw new Error(`字体 web_accessible_resources 范围异常：${JSON.stringify(fontEntry.matches)}`);
}