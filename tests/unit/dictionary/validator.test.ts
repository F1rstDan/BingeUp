import { describe, expect, it } from 'vitest';
import { validateWordRecord, validateDeckRecord, type ValidationResult } from '@/dictionary/validator';
import type { WordRecord, DeckRecord } from '@/types';

function validWord(overrides: Partial<WordRecord> = {}): WordRecord {
  return {
    id: 'w-test',
    word: 'test',
    lemma: 'test',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['测试'],
    exampleSentence: 'He abandoned his car on the highway.',
    exampleTranslation: '他把车丢在了高速公路上。',
    surfaceFormInExample: 'abandoned',
    difficulty: 2,
    source: 'test-source',
    license: 'CC0-1.0',
    ...overrides,
  };
}

function validDeck(overrides: Partial<DeckRecord> = {}): DeckRecord {
  return {
    id: 'deck-daily',
    name: '日常高频',
    description: 'Beta 内置示例词库',
    source: 'builtin-sample',
    license: 'CC0-1.0',
    wordIds: ['w-abandon', 'w-benefit'],
    ...overrides,
  };
}

describe('validateWordRecord — 词库单条校验', () => {
  it('合法记录通过校验', () => {
    const result = validateWordRecord(validWord());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('word 为空字符串时不通过', () => {
    const result = validateWordRecord(validWord({ word: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('word 不能为空');
  });

  it('lemma 为空字符串时不通过', () => {
    const result = validateWordRecord(validWord({ lemma: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('lemma 不能为空');
  });

  it('partOfSpeech 为空数组时不通过', () => {
    const result = validateWordRecord(validWord({ partOfSpeech: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('partOfSpeech 至少需要一项');
  });

  it('partOfSpeech 含空字符串时不通过', () => {
    const result = validateWordRecord(validWord({ partOfSpeech: ['v.', ''] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('partOfSpeech 含有空项');
  });

  it('coreMeaningZh 为空数组时不通过', () => {
    const result = validateWordRecord(validWord({ coreMeaningZh: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('coreMeaningZh 至少需要一项');
  });

  it('coreMeaningZh 含空字符串时不通过', () => {
    const result = validateWordRecord(validWord({ coreMeaningZh: ['放弃', ''] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('coreMeaningZh 含有空项');
  });

  it('有例句但无例句翻译时不通过', () => {
    const result = validateWordRecord(validWord({ exampleTranslation: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('有例句但无例句翻译');
  });

  it('有例句翻译但无例句时不通过', () => {
    const result = validateWordRecord(validWord({ exampleSentence: '', exampleTranslation: '翻译' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('有例句翻译但无例句');
  });

  it('无例句时 surfaceFormInExample 可为空', () => {
    const result = validateWordRecord(validWord({
      exampleSentence: '',
      exampleTranslation: '',
      surfaceFormInExample: '',
    }));
    expect(result.valid).toBe(true);
  });

  it('source 为空时不通过（来源可追溯）', () => {
    const result = validateWordRecord(validWord({ source: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('source 不能为空');
  });

  it('license 为空时不通过（许可证必须记录）', () => {
    const result = validateWordRecord(validWord({ license: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('license 不能为空');
  });

  it('difficulty 不是正数时不通过', () => {
    const result = validateWordRecord(validWord({ difficulty: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('difficulty 必须为正数');
  });
});

describe('validateDeckRecord — 词库记录校验', () => {
  it('合法词库通过校验', () => {
    const result = validateDeckRecord(validDeck());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('name 为空时不通过', () => {
    const result = validateDeckRecord(validDeck({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name 不能为空');
  });

  it('source 为空时不通过', () => {
    const result = validateDeckRecord(validDeck({ source: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('source 不能为空');
  });

  it('license 为空时不通过', () => {
    const result = validateDeckRecord(validDeck({ license: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('license 不能为空');
  });

  it('wordIds 为空数组时不通过', () => {
    const result = validateDeckRecord(validDeck({ wordIds: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('wordIds 至少需要一项');
  });
});

describe('ValidationResult — 类型契约', () => {
  it('valid=true 时 errors 为空数组', () => {
    const ok: ValidationResult = { valid: true, errors: [] };
    expect(ok.valid).toBe(true);
    expect(ok.errors).toHaveLength(0);
  });
});
