import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  DeckRecord,
  DictionaryContentManifest,
  LegacyRegistry,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import { validateContentPackage, validateQuestionPlan } from '@/dictionary/content-contract';
import { sha256Hex } from '@/learning/content-hash';

const DIR = join(process.cwd(), 'data/dictionary-rebuild/staging-pilot');

function read(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}

describe('试批候选包 — 实际交付资源（Issue #61）', () => {
  it('100 词、三词库和固定题组通过全量检查', async () => {
    const texts = {
      words: read('words.json'),
      decks: read('decks.json'),
      questions: read('questions.json'),
      legacyRegistry: read('legacy-registry.json'),
      sourceMetadata: read('source-metadata.json'),
      license: read('LICENSE.txt'),
    };
    const manifest = JSON.parse(read('manifest.json')) as DictionaryContentManifest;
    const words = JSON.parse(texts.words) as WordRecord[];
    const decks = JSON.parse(texts.decks) as DeckRecord[];
    const questions = JSON.parse(texts.questions) as WordQuestionPlan[];
    const registry = JSON.parse(texts.legacyRegistry) as LegacyRegistry;
    const fileHashes = Object.fromEntries(
      await Promise.all(
        Object.entries(texts).map(async ([key, text]) => [key, await sha256Hex(text)]),
      ),
    ) as Record<keyof DictionaryContentManifest['files'], string>;
    const validation = await validateContentPackage({
      manifest,
      words,
      decks,
      questions,
      registry,
      fileHashes,
    });

    expect(validation.errors).toEqual([]);
    expect(words).toHaveLength(100);
    expect(questions).toHaveLength(100);
    expect(decks).toHaveLength(3);
    expect(words.every((word) => word.exampleSentence && word.exampleTranslation)).toBe(true);
    expect(
      words.every((word) => word.phonetic?.startsWith('/') && word.phonetic.endsWith('/')),
    ).toBe(true);
  });

  it('每个词有英选中题组，可选题型有可用样本', async () => {
    const words = JSON.parse(read('words.json')) as WordRecord[];
    const questions = JSON.parse(read('questions.json')) as WordQuestionPlan[];
    const byId = new Map(words.map((word) => [word.id, word]));
    for (const plan of questions) {
      expect(plan.enToZh.distractors).toHaveLength(3);
      expect(await validateQuestionPlan(byId.get(plan.wordId)!, plan, byId)).toEqual([]);
    }
    expect(questions.filter((plan) => plan.contextChoice !== null).length).toBeGreaterThan(0);
    expect(questions.filter((plan) => plan.spelling !== null).length).toBeGreaterThan(0);
    expect(questions.filter((plan) => plan.zhToEn !== null).length).toBeGreaterThan(0);
  });
});
