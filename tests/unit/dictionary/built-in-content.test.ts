import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import {
  PACKAGE_DECKS,
  PACKAGE_WORDS,
  buildPackageTexts,
  packageFetchMock,
} from '../../helpers/content-package';
import type { DeckRecord, DictionaryContentManifest, WordRecord } from '@/types';
import { sha256Hex } from '@/learning/content-hash';

async function buildPackageWith(words: WordRecord[], decks: DeckRecord[]) {
  const { texts } = await buildPackageTexts();
  texts['words.json'] = `${JSON.stringify(words, null, 2)}\n`;
  texts['decks.json'] = `${JSON.stringify(decks, null, 2)}\n`;
  const manifest = JSON.parse(texts['manifest.json']!) as DictionaryContentManifest;
  for (const [name, fileName] of [
    ['words', 'words.json'],
    ['decks', 'decks.json'],
  ] as const) {
    const text = texts[fileName]!;
    manifest.files[name] = { sha256: await sha256Hex(text), bytes: Buffer.byteLength(text) };
  }
  texts['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return texts;
}

async function loadBank(texts: Record<string, string>): Promise<BuiltInWordBank> {
  vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
  const bank = new BuiltInWordBank();
  await bank.listWords();
  return bank;
}

describe('BuiltInWordBank — 当前内容包', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('校验 manifest 与文件哈希后加载词条和题组', async () => {
    const { texts } = await buildPackageTexts();
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();

    expect(await bank.listWords()).toHaveLength(4);
    expect((await bank.getWord('w-reservoir'))?.word).toBe('reservoir');
    expect((await bank.getQuestionPlan('w-reservoir'))?.wordId).toBe('w-reservoir');
    expect(await bank.getWord('w-reservior')).toBeNull();
    expect(await bank.getQuestionPlan('w-reservior')).toBeNull();
  });

  it('任何资源哈希不符时拒绝加载', async () => {
    const { texts } = await buildPackageTexts();
    texts['words.json'] = texts['words.json']!.replace('水库', '水池');
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('内容包校验失败');
  });

  it('缺少 manifest 时拒绝加载', async () => {
    const { texts } = await buildPackageTexts();
    delete texts['manifest.json'];
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('manifest 缺失');
  });

  it('manifest schemaVersion 非法时格式校验失败', async () => {
    const { texts, manifest } = await buildPackageTexts();
    texts['manifest.json'] = JSON.stringify({ ...manifest, schemaVersion: 99 });
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('schemaVersion 必须为 1');
  });

  it('加载失败后清除 in-flight 状态并允许重试', async () => {
    const { texts } = await buildPackageTexts();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockImplementation(packageFetchMock(texts));
    vi.stubGlobal('fetch', fetchMock);
    const bank = new BuiltInWordBank();

    await expect(bank.listWords()).rejects.toThrow('manifest 缺失');
    await expect(bank.listWords()).resolves.toHaveLength(4);
  });

  it('跨难度按全局频率合并，而不是按难度顺序拼接', async () => {
    const { texts } = await buildPackageTexts();
    const bank = await loadBank(texts);

    const sampled = await bank.sampleDeckWords({
      deckId: 'deck-cet4',
      count: 3,
      preferredDifficulty: [2, 3],
      excludeWordIds: [],
    });

    expect(sampled.map((word) => word.id)).toEqual(['w-bench', 'w-mirror', 'w-reservoir']);
  });

  it('先应用排除再截断数量，并保留未知词库和无合格词的空结果', async () => {
    const { texts } = await buildPackageTexts();
    const bank = await loadBank(texts);

    const sampled = await bank.sampleDeckWords({
      deckId: 'deck-cet4',
      count: 1,
      preferredDifficulty: [2, 3],
      excludeWordIds: ['w-bench'],
    });

    expect(sampled.map((word) => word.id)).toEqual(['w-mirror']);
    await expect(
      bank.sampleDeckWords({
        deckId: 'unknown',
        count: 5,
        preferredDifficulty: [1, 2, 3, 4],
        excludeWordIds: [],
      }),
    ).resolves.toEqual([]);
    await expect(
      bank.sampleDeckWords({
        deckId: 'deck-cet4',
        count: 5,
        preferredDifficulty: [4],
        excludeWordIds: [],
      }),
    ).resolves.toEqual([]);
  });

  it('词库内难度覆盖词条难度并参与选择', async () => {
    const decks = PACKAGE_DECKS.map((deck) => ({ ...deck }));
    decks[0] = {
      ...decks[0]!,
      wordDifficulties: { 'w-bench': 1, 'w-candle': 1 },
    };
    const bank = await loadBank(await buildPackageWith(PACKAGE_WORDS, decks));

    const sampled = await bank.sampleDeckWords({
      deckId: 'deck-daily-high-frequency',
      count: 4,
      preferredDifficulty: [1],
      excludeWordIds: [],
    });

    expect(sampled.map((word) => word.id)).toEqual(['w-candle', 'w-bench']);
  });

  it('跨难度同频在 count 截断时都能进入候选', async () => {
    const words = PACKAGE_WORDS.map((word) => ({ ...word, frequencyRank: 100 }));
    const decks = PACKAGE_DECKS.map((deck) => ({ ...deck }));
    decks[1] = {
      ...decks[1]!,
      wordIds: ['w-bench', 'w-candle', 'w-mirror', 'w-reservoir'],
      wordDifficulties: { 'w-bench': 1, 'w-candle': 2, 'w-mirror': 3, 'w-reservoir': 4 },
    };
    const bank = await loadBank(await buildPackageWith(words, decks));
    const random = vi.spyOn(Math, 'random');
    const sequences = [
      [0.99, 0.99, 0.99],
      [0.99, 0.99, 0],
      [0.99, 0, 0.99],
      [0, 0.99, 0.99],
    ];
    for (const value of sequences.flat()) random.mockReturnValueOnce(value);

    const chosen = new Set<string>();
    for (let index = 0; index < sequences.length; index += 1) {
      const sampled = await bank.sampleDeckWords({
        deckId: 'deck-cet4',
        count: 1,
        preferredDifficulty: [1, 2, 3, 4],
        excludeWordIds: [],
      });
      chosen.add(sampled[0]!.id);
    }

    expect(chosen).toEqual(new Set(['w-bench', 'w-candle', 'w-mirror', 'w-reservoir']));
  });

  it('每次调用重新随机，且不污染已构建的候选桶', async () => {
    const words = PACKAGE_WORDS.map((word) => ({ ...word, frequencyRank: 100 }));
    const decks = PACKAGE_DECKS.map((deck) => ({ ...deck }));
    decks[1] = {
      ...decks[1]!,
      wordIds: ['w-bench', 'w-candle', 'w-mirror', 'w-reservoir'],
      wordDifficulties: { 'w-bench': 1, 'w-candle': 2, 'w-mirror': 3, 'w-reservoir': 4 },
    };
    const bank = await loadBank(await buildPackageWith(words, decks));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const args = {
      deckId: 'deck-cet4',
      count: 4,
      preferredDifficulty: [1, 2, 3, 4],
      excludeWordIds: [],
    };

    const first = await bank.sampleDeckWords(args);
    random.mockReturnValue(0.99);
    const second = await bank.sampleDeckWords(args);
    random.mockReturnValue(0);
    const third = await bank.sampleDeckWords(args);

    expect(second.map((word) => word.id)).not.toEqual(first.map((word) => word.id));
    expect(third.map((word) => word.id)).toEqual(first.map((word) => word.id));
  });

  it('全部排除后返回空数组', async () => {
    const { texts } = await buildPackageTexts();
    const bank = await loadBank(texts);

    await expect(
      bank.sampleDeckWords({
        deckId: 'deck-cet4',
        count: 2,
        preferredDifficulty: [2, 3],
        excludeWordIds: ['w-bench', 'w-mirror', 'w-reservoir'],
      }),
    ).resolves.toEqual([]);
  });
});
