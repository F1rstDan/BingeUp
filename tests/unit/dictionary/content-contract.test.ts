import { describe, expect, it } from 'vitest';
import type { DictionaryContentManifest, WordQuestionPlan } from '@/types';
import {
  CONTENT_FILE_NAMES,
  validateBuiltInWordRecord,
  validateContentPackage,
  validateQuestionPlan,
} from '@/dictionary/content-contract';
import { PACKAGE_DECKS, PACKAGE_WORDS, buildPackageTexts } from '../../helpers/content-package';

async function buildPackage() {
  const { manifest, questions } = await buildPackageTexts();
  const fileHashes = Object.fromEntries(
    CONTENT_FILE_NAMES.map((name) => [name, manifest.files[name].sha256]),
  ) as Record<keyof DictionaryContentManifest['files'], string>;
  return { manifest, questions, fileHashes };
}

describe('正式内置词条契约', () => {
  it('接受完整词条', () => {
    expect(validateBuiltInWordRecord(PACKAGE_WORDS[0]!)).toEqual([]);
  });

  it('拒绝多个主词性、多个主释义和缺失例句', () => {
    const errors = validateBuiltInWordRecord({
      ...PACKAGE_WORDS[0]!,
      partOfSpeech: ['v.', 'n.'],
      coreMeaningZh: ['放弃', '遗弃'],
      exampleSentence: '',
      exampleTranslation: '',
      surfaceFormInExample: '',
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'partOfSpeech 必须恰好一项',
        'coreMeaningZh 必须恰好一项',
        'exampleSentence 必填',
      ]),
    );
  });

  it('拒绝长释义、拼接义项和词性前缀', () => {
    expect(
      validateBuiltInWordRecord({
        ...PACKAGE_WORDS[0]!,
        coreMeaningZh: ['这是一个超过二十四个字符的释义文本用于验证长度约束'],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('1–24')]));
    expect(
      validateBuiltInWordRecord({ ...PACKAGE_WORDS[0]!, coreMeaningZh: ['放弃；遗弃'] }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('不能拼接')]));
    expect(validateBuiltInWordRecord({ ...PACKAGE_WORDS[0]!, coreMeaningZh: ['v. 放弃'] })).toEqual(
      expect.arrayContaining([expect.stringContaining('词性前缀')]),
    );
  });

  it('拒绝表层词形出现两次或音标格式错误', () => {
    expect(
      validateBuiltInWordRecord({
        ...PACKAGE_WORDS[0]!,
        exampleSentence: 'The reservoir overflowed, so the reservoir closed.',
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('恰好出现一次')]));
    expect(validateBuiltInWordRecord({ ...PACKAGE_WORDS[0]!, phonetic: 'ˈrezəvˌwɑr' })).toEqual(
      expect.arrayContaining([expect.stringContaining('斜线')]),
    );
  });

  it('拒绝重复的其他义项', () => {
    expect(
      validateBuiltInWordRecord({
        ...PACKAGE_WORDS[0]!,
        secondaryMeanings: [
          { partOfSpeech: 'n.', meaningZh: '储备' },
          { partOfSpeech: 'n.', meaningZh: '储备' },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('其他义项重复')]));
  });
});

describe('固定题组', () => {
  it('固定题组通过依赖哈希检查', async () => {
    const { questions } = await buildPackage();
    const byId = new Map(PACKAGE_WORDS.map((word) => [word.id, word]));
    for (const plan of questions) {
      expect(await validateQuestionPlan(byId.get(plan.wordId)!, plan, byId)).toEqual([]);
    }
  });

  it('依赖改变后检查哈希失效', async () => {
    const { questions } = await buildPackage();
    const changed = PACKAGE_WORDS.map((word) => ({ ...word }));
    changed[0]!.coreMeaningZh = ['水池'];
    const byId = new Map(changed.map((word) => [word.id, word]));
    expect(await validateQuestionPlan(changed[0]!, questions[0]!, byId)).toEqual(
      expect.arrayContaining([expect.stringContaining('检查哈希失效')]),
    );
  });

  it('拒绝干扰项引用目标词或不存在词', async () => {
    const { questions } = await buildPackage();
    const byId = new Map(PACKAGE_WORDS.map((word) => [word.id, word]));
    const broken: WordQuestionPlan = {
      ...questions[0]!,
      enToZh: {
        ...questions[0]!.enToZh,
        distractors: ['w-reservoir', 'w-missing', 'w-candle'],
      },
    };
    expect(await validateQuestionPlan(PACKAGE_WORDS[0]!, broken, byId)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不能包含目标词'),
        expect.stringContaining('引用不存在的单词'),
      ]),
    );
  });
});

describe('内容包校验', () => {
  it('完整内容包通过全量检查', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const result = await validateContentPackage({
      manifest,
      words: PACKAGE_WORDS,
      decks: PACKAGE_DECKS,
      questions,
      fileHashes,
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('manifest schemaVersion 非法时格式校验失败', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const result = await validateContentPackage({
      manifest: {
        ...manifest,
        schemaVersion: 99 as DictionaryContentManifest['schemaVersion'],
      },
      words: PACKAGE_WORDS,
      decks: PACKAGE_DECKS,
      questions,
      fileHashes,
    });
    expect(result.errors).toContain('内容 manifest schemaVersion 必须为 1');
  });

  it('文件哈希或题组数量不一致时拒绝内容包', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const result = await validateContentPackage({
      manifest: { ...manifest, counts: { ...manifest.counts, questionPlans: 3 } },
      words: PACKAGE_WORDS,
      decks: PACKAGE_DECKS,
      questions,
      fileHashes: { ...fileHashes, words: 'd'.repeat(64) },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('包内文件哈希不一致：words'),
        expect.stringContaining('manifest 题组数不一致'),
      ]),
    );
  });

  it('manifest 必须恰好声明五个内容文件', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const missingFiles = { ...manifest.files };
    delete (missingFiles as Partial<typeof missingFiles>).sourceMetadata;
    const result = await validateContentPackage({
      manifest: { ...manifest, files: missingFiles as typeof manifest.files },
      words: PACKAGE_WORDS,
      decks: PACKAGE_DECKS,
      questions,
      fileHashes,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining(['manifest 文件数量必须为 5', 'manifest 缺少文件：sourceMetadata']),
    );
  });

  it('每个有效词必须至少属于一个词库', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const decksWithoutCandle = PACKAGE_DECKS.map((deck) => ({
      ...deck,
      wordIds: deck.wordIds.filter((wordId) => wordId !== 'w-candle'),
      wordDifficulties: Object.fromEntries(
        Object.entries(deck.wordDifficulties ?? {}).filter(([wordId]) => wordId !== 'w-candle'),
      ),
    }));
    const result = await validateContentPackage({
      manifest,
      words: PACKAGE_WORDS,
      decks: decksWithoutCandle,
      questions,
      fileHashes,
    });
    expect(result.errors).toContain('有效词没有词库成员关系：w-candle');
  });

  it('拒绝缺失题组、错误来源和悬空词库成员', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const words = PACKAGE_WORDS.map((word, index) =>
      index === 0 ? { ...word, source: 'other-source' } : word,
    );
    const decks = PACKAGE_DECKS.map((deck, index) =>
      index === 0 ? { ...deck, wordIds: [...deck.wordIds, 'w-missing'] } : deck,
    );
    const result = await validateContentPackage({
      manifest,
      words,
      decks,
      questions: questions.slice(1),
      fileHashes,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('source/license 不是本版内容声明'),
        expect.stringContaining('缺少固定题组'),
        expect.stringContaining('引用不存在的单词 w-missing'),
      ]),
    );
  });
});
