/**
 * 把已验证的 staging 候选包切换为正式 public/dictionaries 内容。
 *
 * 只应在整包验收通过后运行；运行前会完整归档当前 v1 词库。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DeckRecord,
  DictionaryContentManifest,
  LegacyRegistry,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import { validateContentPackage } from '@/dictionary/content-contract';
import { sha256Hex } from '@/learning/content-hash';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data/dictionary-rebuild');
const STAGING = join(DATA_DIR, 'staging');
const PUBLIC = join(ROOT, 'public/dictionaries');

async function main(): Promise<void> {
  if (!existsSync(join(STAGING, 'manifest.json'))) {
    throw new Error('staging 候选包不存在；先运行 npm run dictionary:build');
  }
  const texts = {
    words: readFileSync(join(STAGING, 'words.json'), 'utf8'),
    decks: readFileSync(join(STAGING, 'decks.json'), 'utf8'),
    questions: readFileSync(join(STAGING, 'questions.json'), 'utf8'),
    legacyRegistry: readFileSync(join(STAGING, 'legacy-registry.json'), 'utf8'),
    sourceMetadata: readFileSync(join(STAGING, 'source-metadata.json'), 'utf8'),
    license: readFileSync(join(STAGING, 'LICENSE.txt'), 'utf8'),
  };
  const manifest = JSON.parse(
    readFileSync(join(STAGING, 'manifest.json'), 'utf8'),
  ) as DictionaryContentManifest;
  const fileHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(texts).map(async ([key, text]) => [key, await sha256Hex(text)]),
    ),
  ) as Record<keyof DictionaryContentManifest['files'], string>;
  const validation = await validateContentPackage({
    manifest,
    words: JSON.parse(texts.words) as WordRecord[],
    decks: JSON.parse(texts.decks) as DeckRecord[],
    questions: JSON.parse(texts.questions) as WordQuestionPlan[],
    registry: JSON.parse(texts.legacyRegistry) as LegacyRegistry,
    fileHashes,
  });
  if (!validation.valid) {
    throw new Error(`staging 候选包校验失败：${validation.errors.slice(0, 10).join('；')}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = join(DATA_DIR, 'archive', `legacy-v1-${stamp}`);
  mkdirSync(archive, { recursive: true });
  cpSync(PUBLIC, archive, { recursive: true });
  cpSync(STAGING, PUBLIC, { recursive: true, force: true });
  writeFileSync(
    join(DATA_DIR, 'archive', `switch-${stamp}.json`),
    `${JSON.stringify(
      {
        switchedAt: new Date().toISOString(),
        archive,
        manifest,
        fileHashes,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`正式词库已切换；旧 v1 包归档在 ${archive}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
