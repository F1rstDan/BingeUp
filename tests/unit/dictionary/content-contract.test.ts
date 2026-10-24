import { describe, expect, it } from 'vitest';
import type {
  DeckRecord,
  DictionaryContentManifest,
  LegacyRegistry,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import {
  BUILT_IN_CONTENT_LICENSE,
  BUILT_IN_CONTENT_SOURCE,
  CONTENT_CONTRACT_VERSION,
  computeQuestionPlanHashes,
  validateBuiltInWordRecord,
  validateContentPackage,
  validateLegacyRegistry,
  validateQuestionPlan,
} from '@/dictionary/content-contract';
import { QUESTION_TEMPLATE_VERSION, sha256Hex } from '@/learning/content-hash';

const WORDS: WordRecord[] = [
  {
    id: 'w-abandon',
    word: 'abandon',
    lemma: 'abandon',
    phonetic: '/əˈbændən/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['放弃'],
    secondaryMeanings: [{ partOfSpeech: 'v.', meaningZh: '遗弃' }],
    exampleSentence: 'They abandoned the old plan.',
    exampleTranslation: '他们放弃了旧计划。',
    surfaceFormInExample: 'abandoned',
    difficulty: 1,
    frequencyRank: 2182,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-decline',
    word: 'decline',
    lemma: 'decline',
    phonetic: '/dɪˈklaɪn/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['下降'],
    exampleSentence: 'Sales declined last month.',
    exampleTranslation: '上个月销量下降了。',
    surfaceFormInExample: 'declined',
    difficulty: 2,
    frequencyRank: 3000,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-accept',
    word: 'accept',
    lemma: 'accept',
    phonetic: '/əkˈsɛpt/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['接受'],
    exampleSentence: 'She accepted the offer.',
    exampleTranslation: '她接受了这个提议。',
    surfaceFormInExample: 'accepted',
    difficulty: 2,
    frequencyRank: 3200,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-reduce',
    word: 'reduce',
    lemma: 'reduce',
    phonetic: '/ɹɪˈdus/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['减少'],
    exampleSentence: 'We reduced the cost by half.',
    exampleTranslation: '我们把成本减少了一半。',
    surfaceFormInExample: 'reduced',
    difficulty: 2,
    frequencyRank: 2800,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
];

const DECKS: DeckRecord[] = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: WORDS.map((word) => word.id),
    wordDifficulties: Object.fromEntries(WORDS.map((word) => [word.id, word.difficulty])),
  },
  {
    id: 'deck-cet4',
    name: '四级',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: ['w-abandon', 'w-decline'],
    wordDifficulties: { 'w-abandon': 1, 'w-decline': 2 },
  },
  {
    id: 'deck-cet6',
    name: '六级',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: ['w-accept', 'w-reduce'],
    wordDifficulties: { 'w-accept': 2, 'w-reduce': 2 },
  },
];

const REGISTRY: LegacyRegistry = {
  schemaVersion: 1,
  registryVersion: 'legacy-registry-1',
  registryHash: 'a'.repeat(64),
  datasetId: 'test-dataset',
  seedHash: 'b'.repeat(64),
  source: {
    name: 'ECDICT',
    repository: 'https://example.com',
    commit: 'test',
    license: 'MIT',
    capturedAt: '2026-10-23',
    note: 'test',
  },
  review: { reviewedAt: '2026-10-23', method: 'test', evidenceSources: [] },
  entries: WORDS.map((word) => ({
    legacyId: word.id,
    disposition: 'keep' as const,
    canonicalId: word.id,
    canonicalWord: word.word,
    reason: 'test',
    evidence: ['test'],
    seedEntryHash: 'c'.repeat(64),
    original: {
      word: word.word,
      difficulty: word.difficulty,
      frequencyRank: word.frequencyRank,
      decks: DECKS.filter((deck) => deck.wordIds.includes(word.id)).map((deck) => ({
        deckId: deck.id,
        difficulty: word.difficulty,
      })),
    },
  })),
};

async function buildPlans(): Promise<WordQuestionPlan[]> {
  const byId = new Map(WORDS.map((word) => [word.id, word]));
  const plans: WordQuestionPlan[] = [];
  for (const [index, word] of WORDS.entries()) {
    const others = WORDS.filter((candidate) => candidate.id !== word.id);
    const distractors = [
      others[index % 3]!.id,
      others[(index + 1) % 3]!.id,
      others[(index + 2) % 3]!.id,
    ] as [string, string, string];
    const draft: WordQuestionPlan = {
      wordId: word.id,
      enToZh: { distractors, checkedContentHash: '' },
      zhToEn: { distractors, checkedContentHash: '' },
      contextChoice: {
        distractors: distractors.map((id) => ({
          wordId: id,
          surfaceForm: byId.get(id)!.word,
        })) as [
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
        ],
        checkedContentHash: '',
      },
      spelling: { prefixLength: 1, checkedContentHash: '' },
    };
    const hashes = await computeQuestionPlanHashes(word, draft, byId);
    plans.push({
      ...draft,
      enToZh: { ...draft.enToZh, checkedContentHash: hashes.enToZh },
      zhToEn: { ...draft.zhToEn!, checkedContentHash: hashes.zhToEn! },
      contextChoice: { ...draft.contextChoice!, checkedContentHash: hashes.contextChoice! },
      spelling: { ...draft.spelling!, checkedContentHash: hashes.spelling! },
    });
  }
  return plans;
}

async function buildPackage() {
  const questions = await buildPlans();
  const texts = {
    words: `${JSON.stringify(WORDS, null, 2)}\n`,
    decks: `${JSON.stringify(DECKS, null, 2)}\n`,
    questions: `${JSON.stringify(questions, null, 2)}\n`,
    legacyRegistry: `${JSON.stringify(REGISTRY, null, 2)}\n`,
    sourceMetadata: '{}\n',
    license: 'test license\n',
  };
  const files = Object.fromEntries(
    await Promise.all(
      Object.entries(texts).map(async ([key, text]) => [
        key,
        { sha256: await sha256Hex(text), bytes: Buffer.byteLength(text) },
      ]),
    ),
  ) as DictionaryContentManifest['files'];
  const manifest: DictionaryContentManifest = {
    schemaVersion: 2,
    contentContractVersion: CONTENT_CONTRACT_VERSION,
    dictionaryVersion: '2026.10.1',
    generatedAt: '2026-10-23T00:00:00.000Z',
    datasetId: REGISTRY.datasetId,
    registryVersion: REGISTRY.registryVersion,
    registryHash: REGISTRY.registryHash,
    questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
    files,
    counts: { legacyWords: 4, effectiveWords: 4, decks: 3, questionPlans: 4 },
    source: { content: BUILT_IN_CONTENT_SOURCE, license: BUILT_IN_CONTENT_LICENSE },
  };
  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([key, value]) => [key, value.sha256]),
  ) as Record<keyof DictionaryContentManifest['files'], string>;
  return { questions, manifest, fileHashes, texts };
}

describe('正式内置词条契约', () => {
  it('接受完整词条', () => {
    expect(validateBuiltInWordRecord(WORDS[0]!)).toEqual([]);
  });

  it('拒绝多个主词性、多个主释义和缺失例句', () => {
    const errors = validateBuiltInWordRecord({
      ...WORDS[0]!,
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
        ...WORDS[0]!,
        coreMeaningZh: ['这是一个超过二十四个字符的释义文本用于验证长度约束'],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('1–24')]));
    expect(validateBuiltInWordRecord({ ...WORDS[0]!, coreMeaningZh: ['放弃；遗弃'] })).toEqual(
      expect.arrayContaining([expect.stringContaining('不能拼接')]),
    );
    expect(validateBuiltInWordRecord({ ...WORDS[0]!, coreMeaningZh: ['v. 放弃'] })).toEqual(
      expect.arrayContaining([expect.stringContaining('词性前缀')]),
    );
  });

  it('拒绝表层词形出现两次或音标格式错误', () => {
    expect(
      validateBuiltInWordRecord({
        ...WORDS[0]!,
        exampleSentence: 'They abandoned it, but he abandoned nothing.',
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('恰好出现一次')]));
    expect(validateBuiltInWordRecord({ ...WORDS[0]!, phonetic: 'əˈbændən' })).toEqual(
      expect.arrayContaining([expect.stringContaining('斜线')]),
    );
  });

  it('拒绝重复的其他义项', () => {
    expect(
      validateBuiltInWordRecord({
        ...WORDS[0]!,
        secondaryMeanings: [
          { partOfSpeech: 'v.', meaningZh: '遗弃' },
          { partOfSpeech: 'v.', meaningZh: '遗弃' },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('其他义项重复')]));
  });
});

describe('固定题组与内容包', () => {
  it('固定题组通过依赖哈希检查', async () => {
    const plans = await buildPlans();
    const byId = new Map(WORDS.map((word) => [word.id, word]));
    for (const plan of plans) {
      expect(await validateQuestionPlan(byId.get(plan.wordId)!, plan, byId)).toEqual([]);
    }
  });

  it('依赖改变后检查哈希失效', async () => {
    const plans = await buildPlans();
    const changed = WORDS.map((word) => ({ ...word }));
    changed[0]!.coreMeaningZh = ['抛弃'];
    const byId = new Map(changed.map((word) => [word.id, word]));
    expect(await validateQuestionPlan(changed[0]!, plans[0]!, byId)).toEqual(
      expect.arrayContaining([expect.stringContaining('检查哈希失效')]),
    );
  });

  it('拒绝干扰项引用目标词或不存在词', async () => {
    const plans = await buildPlans();
    const byId = new Map(WORDS.map((word) => [word.id, word]));
    const broken = {
      ...plans[0]!,
      enToZh: {
        ...plans[0]!.enToZh,
        distractors: ['w-abandon', 'w-missing', 'w-decline'] as [string, string, string],
      },
    };
    expect(await validateQuestionPlan(WORDS[0]!, broken, byId)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不能包含目标词'),
        expect.stringContaining('引用不存在的单词'),
      ]),
    );
  });

  it('完整内容包通过全量检查', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const result = await validateContentPackage({
      manifest,
      words: WORDS,
      decks: DECKS,
      questions,
      registry: REGISTRY,
      fileHashes,
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('文件哈希或题组数量不一致时拒绝内容包', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const result = await validateContentPackage({
      manifest: { ...manifest, counts: { ...manifest.counts, questionPlans: 3 } },
      words: WORDS,
      decks: DECKS,
      questions,
      registry: REGISTRY,
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

  it('注册表拒绝悬空合并映射', async () => {
    const { manifest, questions, fileHashes } = await buildPackage();
    const broken: LegacyRegistry = {
      ...REGISTRY,
      entries: [
        ...REGISTRY.entries.slice(0, 3),
        { ...REGISTRY.entries[3]!, canonicalId: 'w-missing', disposition: 'merge' as const },
      ],
    };
    const result = await validateContentPackage({
      manifest,
      words: WORDS,
      decks: DECKS,
      questions,
      registry: broken,
      fileHashes,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('指向不存在的有效词')]),
    );
  });

  it('注册表拒绝重复旧 ID、保留项改写身份和循环映射', () => {
    const byId = new Map(WORDS.map((word) => [word.id, word]));
    const decks = new Map(DECKS.map((deck) => [deck.id, deck]));
    const duplicate = {
      ...REGISTRY,
      entries: [...REGISTRY.entries, { ...REGISTRY.entries[0]! }],
    };
    expect(validateLegacyRegistry(duplicate, byId, decks)).toEqual(
      expect.arrayContaining([expect.stringContaining('重复旧 ID')]),
    );

    const rewritten = {
      ...REGISTRY,
      entries: REGISTRY.entries.map((entry, index) =>
        index === 0 ? { ...entry, canonicalId: 'w-decline' } : entry,
      ),
    };
    expect(validateLegacyRegistry(rewritten, byId, decks)).toEqual(
      expect.arrayContaining([expect.stringContaining('保留项不能改写身份')]),
    );

    const cyclic = {
      ...REGISTRY,
      entries: [
        { ...REGISTRY.entries[0]!, disposition: 'merge' as const, canonicalId: 'w-decline' },
        { ...REGISTRY.entries[1]!, disposition: 'merge' as const, canonicalId: 'w-abandon' },
        ...REGISTRY.entries.slice(2),
      ],
    };
    expect(validateLegacyRegistry(cyclic, byId, decks)).toEqual(
      expect.arrayContaining([expect.stringContaining('循环映射')]),
    );
  });
});
