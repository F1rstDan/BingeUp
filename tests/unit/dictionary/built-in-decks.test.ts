import { describe, expect, it } from 'vitest';
import { BUILT_IN_DECKS, getBuiltInDeck, getBuiltInWord, listBuiltInWords } from '@/dictionary/built-in/decks';
import { validateWordRecord, validateDeckRecord } from '@/dictionary/validator';

describe('内置词库 — 授权与来源（Issue #5 验收标准 1）', () => {
  it('每个内置词库都记录了来源和许可证', () => {
    for (const deck of BUILT_IN_DECKS) {
      expect(deck.source.length).toBeGreaterThan(0);
      expect(deck.license.length).toBeGreaterThan(0);
    }
  });

  it('每个内置单词都记录了来源和许可证', () => {
    for (const deck of BUILT_IN_DECKS) {
      for (const wordId of deck.wordIds) {
        const word = getBuiltInWord(wordId);
        expect(word).not.toBeNull();
        expect(word!.source.length).toBeGreaterThan(0);
        expect(word!.license.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('内置词库 — 数据校验（Issue #5 验收标准 1）', () => {
  it('每个内置词库记录通过 validateDeckRecord', () => {
    for (const deck of BUILT_IN_DECKS) {
      const result = validateDeckRecord(deck);
      expect(result.valid, result.errors.join('; ')).toBe(true);
    }
  });

  it('每个内置单词记录通过 validateWordRecord', () => {
    const words = listBuiltInWords();
    expect(words.length).toBeGreaterThanOrEqual(4);
    for (const word of words) {
      const result = validateWordRecord(word);
      expect(result.valid, `${word.word}: ${result.errors.join('; ')}`).toBe(true);
    }
  });

  it('词库的 wordIds 与实际单词一一对应，无悬空引用', () => {
    for (const deck of BUILT_IN_DECKS) {
      for (const wordId of deck.wordIds) {
        expect(getBuiltInWord(wordId), `词库 ${deck.id} 引用了不存在的单词 ${wordId}`).not.toBeNull();
      }
    }
  });

  it('同一词库内 wordId 不重复', () => {
    for (const deck of BUILT_IN_DECKS) {
      const unique = new Set(deck.wordIds);
      expect(unique.size).toBe(deck.wordIds.length);
    }
  });

  it('不同单词的 coreMeaningZh 首项互不重复（保证可构造唯一选项）', () => {
    const words = listBuiltInWords();
    const firstMeanings = words.map((w) => w.coreMeaningZh[0]);
    const unique = new Set(firstMeanings);
    expect(unique.size).toBe(firstMeanings.length);
  });
});

describe('内置词库 — 查询接口', () => {
  it('getBuiltInDeck 返回默认词库', () => {
    const deck = getBuiltInDeck(BUILT_IN_DECKS[0]!.id);
    expect(deck).not.toBeNull();
    expect(deck!.wordIds.length).toBeGreaterThanOrEqual(4);
  });

  it('getBuiltInWord 对不存在的 id 返回 null', () => {
    expect(getBuiltInWord('nonexistent')).toBeNull();
  });

  it('listBuiltInWords 返回所有词库的单词', () => {
    const uniqueWordIds = new Set(BUILT_IN_DECKS.flatMap((d) => d.wordIds));
    expect(listBuiltInWords().length).toBe(uniqueWordIds.size);
  });
});
