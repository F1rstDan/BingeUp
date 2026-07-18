import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const outputName = process.argv[2] ?? 'chrome-mv3';
const outputRoot = join(process.cwd(), '.output', outputName);
const forbiddenPathFragment = 'dev-tools';
const forbiddenTokens = [
  'DEV_SHOW_CARD',
  'DEV_PREPARE_CARD',
  'DEV_GET_DECK_SUMMARY',
  'DEV_GET_DATA_SNAPSHOT',
  '开发工具',
];

const files = await collectFiles(outputRoot);
const failures = [];

for (const file of files) {
  const relativePath = relative(outputRoot, file).replaceAll('\\', '/');
  if (relativePath.includes(forbiddenPathFragment)) {
    failures.push(`${relativePath}: production build contains a dev-tools path`);
    continue;
  }
  if (!/\.(?:html|js|css|json|map)$/.test(relativePath)) continue;
  const contents = await readFile(file, 'utf8');
  for (const token of forbiddenTokens) {
    if (contents.includes(token)) failures.push(`${relativePath}: found ${token}`);
  }
}

if (failures.length > 0) {
  console.error('开发工具生产构建校验失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`开发工具生产构建校验通过：${outputName}`);
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}
