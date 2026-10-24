/**
 * 把归档的旧词库恢复到 public/dictionaries。
 *
 * 只恢复词库文件，不修改 IndexedDB。回滚前先在设置页导出当前 v2 数据，
 * 回滚后再导入该备份，避免丢失新进度。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256Hex } from '@/learning/content-hash';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data/dictionary-rebuild');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');
const PUBLIC = join(ROOT, 'public/dictionaries');
const REQUIRED = [
  'manifest.json',
  'words.json',
  'decks.json',
  'source-metadata.json',
  'LICENSE.txt',
];

function readManifest(dir: string): { schemaVersion?: number; dictionaryVersion?: string } {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    schemaVersion?: number;
    dictionaryVersion?: string;
  };
}

function assertPackage(dir: string): void {
  for (const name of REQUIRED) {
    if (!existsSync(join(dir, name))) throw new Error(`${dir} 缺少 ${name}`);
  }
}

function latestV1Archive(): string {
  const candidates = readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('legacy-v1-'))
    .map((entry) => join(ARCHIVE_DIR, entry.name))
    .sort()
    .reverse();
  const found = candidates.find((dir) => {
    try {
      return readManifest(dir).schemaVersion === 1;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error('archive 中没有可用的 legacy-v1 包');
  return found;
}

async function packageHashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of REQUIRED) {
    out[name] = await sha256Hex(readFileSync(join(dir, name), 'utf8'));
  }
  return out;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
  const source = fromArg ? resolve(fromArg.slice('--from='.length)) : latestV1Archive();
  assertPackage(source);
  const targetManifest = readManifest(source);
  if (targetManifest.schemaVersion !== 1) {
    throw new Error(`${source} 不是 schema 1 回滚包`);
  }
  const currentManifest = existsSync(join(PUBLIC, 'manifest.json'))
    ? readManifest(PUBLIC)
    : { schemaVersion: undefined };

  console.log(`回滚源：${source}`);
  console.log(`当前包：schema ${currentManifest.schemaVersion ?? 'unknown'}`);
  console.log(`目标包：schema ${targetManifest.schemaVersion}`);
  if (dryRun) {
    console.log('dry-run：未修改 public/dictionaries');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(ARCHIVE_DIR, `pre-rollback-${stamp}`);
  mkdirSync(backup, { recursive: true });
  cpSync(PUBLIC, backup, { recursive: true });
  const before = await packageHashes(PUBLIC);
  const after = await packageHashes(source);

  const next = join(ROOT, 'public/dictionaries.next');
  const previous = join(ROOT, 'public/dictionaries.rollback-prev');
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  cpSync(source, next, { recursive: true });
  assertPackage(next);
  try {
    renameSync(PUBLIC, previous);
    renameSync(next, PUBLIC);
  } catch (error) {
    if (!existsSync(PUBLIC) && existsSync(previous)) renameSync(previous, PUBLIC);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  writeFileSync(
    join(ARCHIVE_DIR, `rollback-${stamp}.json`),
    `${JSON.stringify({ rolledBackAt: new Date().toISOString(), source, backup, before, after }, null, 2)}\n`,
    'utf8',
  );
  console.log(`已回滚到 schema 1；切换前包归档在 ${backup}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
