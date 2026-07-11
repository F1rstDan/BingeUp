import { describe, expect, it } from 'vitest';
import { generateEnToZhQuestion, meaningText } from '@/learning/question-generator';
import type { WordRecord } from '@/types';

function makeWord(overrides: Partial<WordRecord> = {}): WordRecord {
  return {
    id: 'w-test',
    word: 'abandon',
    lemma: 'abandon',
    phonetic: '/əˈbændən/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['放弃；遗弃'],
    exampleSentence: 'He abandoned his car.',
    exampleTranslation: '他把车丢弃了。',
    difficulty: 2,
    source: 'builtin-sample',
    license: 'CC0-1.0',
    ...overrides,
  };
}

const TARGET = makeWord({ id: 'w-abandon', word: 'abandon', coreMeaningZh: ['放弃；遗弃'] });
const DISTRACTORS: WordRecord[] = [
  makeWord({ id: 'w-benefit', word: 'benefit', coreMeaningZh: ['利益；好处'] }),
  makeWord({ id: 'w-capable', word: 'capable', coreMeaningZh: ['有能力的；能干的'] }),
  makeWord({ id: 'w-deliberate', word: 'deliberate', coreMeaningZh: ['故意的；深思熟虑的'] }),
];

describe('meaningText — 释义文本', () => {
  it('将 coreMeaningZh 数组用分号连接', () => {
    const word = makeWord({ coreMeaningZh: ['放弃', '遗弃'] });
    expect(meaningText(word)).toBe('放弃；遗弃');
  });

  it('单项释义原样返回', () => {
    expect(meaningText(TARGET)).toBe('放弃；遗弃');
  });
});

describe('generateEnToZhQuestion — 英文选中文题目（Issue #5 验收标准 2）', () => {
  it('生成包含四个选项的题目', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q.options).toHaveLength(4);
  });

  it('四个选项互不重复', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    const unique = new Set(q.options);
    expect(unique.size).toBe(4);
  });

  it('只有一个正确答案（correctIndex 指向的选项等于目标释义）', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    const correctOption = q.options[q.correctIndex];
    expect(correctOption).toBe(meaningText(TARGET));

    // 其余选项都不等于目标释义
    const correctCount = q.options.filter((o) => o === meaningText(TARGET)).length;
    expect(correctCount).toBe(1);
  });

  it('题干是目标单词的英文词形', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q.prompt).toBe('abandon');
  });

  it('题型为 en-to-zh', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q.type).toBe('en-to-zh');
  });

  it('题目关联到指定的学习卡', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q.cardId).toBe('card-1');
    expect(q.wordId).toBe(TARGET.id);
  });

  it('解释信息包含单词、词性、释义和例句', () => {
    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q.explanation.word).toBe('abandon');
    expect(q.explanation.partOfSpeech).toEqual(['v.']);
    expect(q.explanation.meanings).toEqual(['放弃；遗弃']);
    expect(q.explanation.exampleSentence).toBe('He abandoned his car.');
    expect(q.explanation.exampleTranslation).toBe('他把车丢弃了。');
  });

  it('干扰项与目标释义重复时自动过滤', () => {
    const duplicateDistractor = makeWord({
      id: 'w-dup',
      word: 'forsake',
      coreMeaningZh: ['放弃；遗弃'], // 与目标相同
    });
    const extraDistractor = makeWord({
      id: 'w-extra',
      word: 'enhance',
      coreMeaningZh: ['提高；增强'],
    });

    const q = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: [duplicateDistractor, ...DISTRACTORS, extraDistractor],
      cardId: 'card-1',
    });

    const correctCount = q.options.filter((o) => o === meaningText(TARGET)).length;
    expect(correctCount).toBe(1);
    expect(q.options).toHaveLength(4);
  });

  it('干扰项不足三个时抛出错误', () => {
    expect(() =>
      generateEnToZhQuestion({
        targetWord: TARGET,
        distractors: [DISTRACTORS[0]!, DISTRACTORS[1]!],
        cardId: 'card-1',
      }),
    ).toThrow();
  });

  it('正确答案位置经过随机打乱（不同随机源产生不同位置）', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const q = generateEnToZhQuestion({
        targetWord: TARGET,
        distractors: DISTRACTORS,
        cardId: 'card-1',
      });
      seen.add(q.correctIndex);
    }
    // 在 50 次生成中，正确答案至少出现在 2 个不同位置
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('使用注入的随机函数时结果确定', () => {
    // 固定随机函数：总是返回 0，打乱后顺序不变
    const noShuffle = () => 0;
    const q1 = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
      random: noShuffle,
    });
    const q2 = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
      random: noShuffle,
    });

    expect(q1.options).toEqual(q2.options);
    expect(q1.correctIndex).toBe(q2.correctIndex);
  });

  it('生成的题目有唯一 id', () => {
    const q1 = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });
    const q2 = generateEnToZhQuestion({
      targetWord: TARGET,
      distractors: DISTRACTORS,
      cardId: 'card-1',
    });

    expect(q1.id).toBeTruthy();
    expect(q2.id).toBeTruthy();
    expect(q1.id).not.toBe(q2.id);
  });
});
