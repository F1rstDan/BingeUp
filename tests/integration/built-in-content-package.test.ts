import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeckRecord, DictionaryContentManifest, WordQuestionPlan, WordRecord } from '@/types';
import { CONTENT_FILE_NAMES, validateContentPackage } from '@/dictionary/content-contract';
import { sha256Hex } from '@/learning/content-hash';

const DIR = join(process.cwd(), 'public/dictionaries');
const FILE_NAMES = {
  words: 'words.json',
  decks: 'decks.json',
  questions: 'questions.json',
  sourceMetadata: 'source-metadata.json',
  license: 'LICENSE.txt',
} as const;

function read(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}

describe('正式内置内容包', () => {
  it('使用 schemaVersion 1 的五个内容文件', () => {
    const manifest = JSON.parse(read('manifest.json')) as DictionaryContentManifest & {
      registryVersion?: unknown;
      registryHash?: unknown;
    };
    const source = JSON.parse(read('source-metadata.json')) as {
      schemaVersion: number;
      contentVersion: string;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.dictionaryVersion).toBe('1');
    expect(source.schemaVersion).toBe(1);
    expect(source.contentVersion).toBe('1');
    expect(Object.keys(manifest.files).sort()).toEqual([...CONTENT_FILE_NAMES].sort());
    expect(manifest).not.toHaveProperty('registryVersion');
    expect(manifest).not.toHaveProperty('registryHash');
    expect(manifest.counts).toEqual({ effectiveWords: 5374, decks: 3, questionPlans: 5374 });
  });

  it('5374 词、三个词库和固定题组通过全量严格检查', async () => {
    const texts = Object.fromEntries(
      CONTENT_FILE_NAMES.map((key) => [key, read(FILE_NAMES[key])]),
    ) as Record<(typeof CONTENT_FILE_NAMES)[number], string>;
    const manifest = JSON.parse(read('manifest.json')) as DictionaryContentManifest;
    const words = JSON.parse(texts.words) as WordRecord[];
    const decks = JSON.parse(texts.decks) as DeckRecord[];
    const questions = JSON.parse(texts.questions) as WordQuestionPlan[];
    const fileHashes = Object.fromEntries(
      await Promise.all(CONTENT_FILE_NAMES.map(async (key) => [key, await sha256Hex(texts[key])])),
    ) as Record<keyof DictionaryContentManifest['files'], string>;

    for (const key of CONTENT_FILE_NAMES) {
      expect(manifest.files[key].bytes).toBe(Buffer.byteLength(texts[key]));
    }
    const validation = await validateContentPackage({
      manifest,
      words,
      decks,
      questions,
      fileHashes,
    });

    expect(validation.errors).toEqual([]);
    expect(words).toHaveLength(5374);
    expect(questions).toHaveLength(5374);
    expect(decks).toHaveLength(3);
    expect(words.every((word) => word.exampleSentence && word.exampleTranslation)).toBe(true);
    expect(
      words.every((word) => word.phonetic?.startsWith('/') && word.phonetic.endsWith('/')),
    ).toBe(true);
    expect(questions.filter((plan) => plan.contextChoice !== null).length).toBeGreaterThan(0);
    expect(questions.filter((plan) => plan.spelling !== null).length).toBeGreaterThan(0);
    expect(questions.filter((plan) => plan.zhToEn !== null).length).toBeGreaterThan(0);
  }, 30_000);
});
