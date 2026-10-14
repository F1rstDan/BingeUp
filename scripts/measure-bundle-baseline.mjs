/**
 * 迁移基线体积测量（工单 #37）。
 *
 * 用法：node scripts/measure-bundle-baseline.mjs
 * 前置：npm run build && npm run build:edge（zip 数据需 npm run zip 与 npm run zip -- -b edge）
 *
 * 输出 JSON：Chrome/Edge 解包体积与文件数、zip 体积、Popup 入口闭包、content script 体积。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const outputDir = join(projectRoot, '.output');

function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function directoryStats(dir) {
  if (!existsSync(dir)) return null;
  const files = listFiles(dir);
  return { files: files.length, bytes: files.reduce((sum, file) => sum + statSync(file).size, 0) };
}

function fileBytes(file) {
  return existsSync(file) ? statSync(file).size : 0;
}

/** 递归解析相对 import，得到 JS 闭包（Popup 入口使用）。 */
function jsClosure(entry) {
  const seen = new Set();
  const stack = [resolve(entry)];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file) || !file.endsWith('.js')) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*["'](\.\.?\/[^"']+)["']/g)) {
      stack.push(resolve(dirname(file), match[1]));
    }
  }
  return [...seen];
}

/** HTML 入口闭包：静态引用的 JS/CSS，加上 JS 的相对 import。 */
function htmlClosure(htmlFile) {
  const files = new Set();
  const html = readFileSync(htmlFile, 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^https?:/.test(ref)) continue;
    const file = resolve(dirname(htmlFile), ref.replace(/^\//, ''));
    if (!existsSync(file)) continue;
    files.add(file);
    for (const dependency of jsClosure(file)) files.add(dependency);
  }
  return [...files].map((file) => ({ file: relative(projectRoot, file), bytes: fileBytes(file) }));
}

function describeOutput(dir) {
  const unpacked = directoryStats(dir);
  const popupHtml = join(dir, 'popup.html');
  const popup = existsSync(popupHtml) ? htmlClosure(popupHtml) : [];
  const optionsHtml = join(dir, 'options.html');
  const options = existsSync(optionsHtml) ? htmlClosure(optionsHtml) : [];
  const onboardingHtml = join(dir, 'onboarding.html');
  const onboarding = existsSync(onboardingHtml) ? htmlClosure(onboardingHtml) : [];
  const statsHtml = join(dir, 'stats.html');
  const stats = existsSync(statsHtml) ? htmlClosure(statsHtml) : [];
  const contentScript = [
    join(dir, 'content-scripts', 'content.js'),
    join(dir, 'content-scripts', 'content.css'),
  ]
    .filter((file) => existsSync(file))
    .map((file) => ({ file: relative(projectRoot, file), bytes: fileBytes(file) }));
  return {
    dir: relative(projectRoot, dir),
    unpacked,
    popup: { bytes: popup.reduce((sum, item) => sum + item.bytes, 0), files: popup },
    options: { bytes: options.reduce((sum, item) => sum + item.bytes, 0), files: options },
    onboarding: {
      bytes: onboarding.reduce((sum, item) => sum + item.bytes, 0),
      files: onboarding,
    },
    stats: {
      bytes: stats.reduce((sum, item) => sum + item.bytes, 0),
      files: stats,
    },
    contentScript: {
      bytes: contentScript.reduce((sum, item) => sum + item.bytes, 0),
      files: contentScript,
    },
  };
}

const zips = existsSync(outputDir)
  ? readdirSync(outputDir)
      .filter((name) => name.endsWith('.zip'))
      .map((name) => ({ name, bytes: fileBytes(join(outputDir, name)) }))
  : [];

const report = {
  generatedAt: new Date().toISOString(),
  chrome: describeOutput(join(outputDir, 'chrome-mv3')),
  edge: describeOutput(join(outputDir, 'edge-mv3')),
  zips,
};

console.log(JSON.stringify(report, null, 2));
