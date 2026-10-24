/** 校验 public/dictionaries 的正式交付包；旧 schema 1 只报告兼容状态。 */
import { readFileSync } from 'node:fs';
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

const DIR = join(process.cwd(), 'public/dictionaries');

async function main(): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(join(DIR, 'manifest.json'), 'utf8'),
  ) as DictionaryContentManifest & { schemaVersion: number };
  if (manifest.schemaVersion !== 2) {
    console.log('词库包仍是旧 schema 1；切换前允许继续运行。');
    return;
  }
  const texts = {
    words: readFileSync(join(DIR, 'words.json'), 'utf8'),
    decks: readFileSync(join(DIR, 'decks.json'), 'utf8'),
    questions: readFileSync(join(DIR, 'questions.json'), 'utf8'),
    legacyRegistry: readFileSync(join(DIR, 'legacy-registry.json'), 'utf8'),
    sourceMetadata: readFileSync(join(DIR, 'source-metadata.json'), 'utf8'),
    license: readFileSync(join(DIR, 'LICENSE.txt'), 'utf8'),
  };
  const fileHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(texts).map(async ([key, text]) => [key, await sha256Hex(text)]),
    ),
  ) as Record<keyof DictionaryContentManifest['files'], string>;
  const words = JSON.parse(texts.words) as WordRecord[];
  const decks = JSON.parse(texts.decks) as DeckRecord[];
  const questions = JSON.parse(texts.questions) as WordQuestionPlan[];
  const registry = JSON.parse(texts.legacyRegistry) as LegacyRegistry;
  const validation = await validateContentPackage({
    manifest,
    words,
    decks,
    questions,
    registry,
    fileHashes,
  });
  if (!validation.valid) {
    console.error(`词库包校验失败：${validation.errors.length} 项`);
    for (const error of validation.errors.slice(0, 20)) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `词库包校验通过：原始 ${manifest.counts.legacyWords}，有效 ${words.length}，题组 ${questions.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
