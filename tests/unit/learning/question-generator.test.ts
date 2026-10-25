import { describe, expect, it } from 'vitest';
import { chooseQuestionType } from '@/learning/question-generator';

describe('chooseQuestionType', () => {
  it('短期学习词使用 en-to-zh', () => {
    expect(chooseQuestionType('short-term')).toBe('en-to-zh');
  });

  it('自报认识词使用 en-to-zh', () => {
    expect(chooseQuestionType('self-reported-known')).toBe('en-to-zh');
  });

  it('长期复习词 reps < 2 时使用 zh-to-en', () => {
    expect(chooseQuestionType('long-term', 0)).toBe('zh-to-en');
    expect(chooseQuestionType('long-term', 1)).toBe('zh-to-en');
  });

  it('长期复习词 reps >= 2 时使用 context-choice', () => {
    expect(chooseQuestionType('long-term', 2)).toBe('context-choice');
    expect(chooseQuestionType('long-term', 5)).toBe('context-choice');
  });

  it('长期复习词无 reps 信息时默认 zh-to-en', () => {
    expect(chooseQuestionType('long-term')).toBe('zh-to-en');
  });
});
