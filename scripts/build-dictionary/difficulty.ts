/**
 * 难度计算模块。
 *
 * 规则 v1：
 * - 1：Oxford 3000，或 frq 排名前 3000，或初高中基础词
 * - 2：CET4，或 frq 排名 3001-8000
 * - 3：CET6，或 frq 排名 8001-15000
 * - 4：其他首发词库中的低频词
 */
import type { Difficulty } from './types';

/**
 * 计算单词的通用难度（基于词频和考试标签）。
 * frq 为 0 或无效时使用 bnc 回退。
 */
export function computeDifficulty(
  frq: number,
  bnc: number,
  isOxford3000: boolean,
  tags: string[],
): Difficulty {
  // Oxford 3000 → 1
  if (isOxford3000) return 1;

  // 使用 frq 为主，bnc 回退
  const freqRank = frq > 0 ? frq : bnc > 0 ? bnc : Number.MAX_SAFE_INTEGER;

  if (freqRank <= 3000) return 1;
  if (freqRank <= 8000) {
    // CET4 范围，但检查是否实际有 CET4 标签
    if (tags.includes('cet4')) return 2;
    return 2;
  }
  if (freqRank <= 15000) {
    if (tags.includes('cet6')) return 3;
    return 3;
  }
  return 4;
}

/**
 * 计算单词在特定词库中的难度。
 * 词库内难度基于该词在词库内的相对词频排名。
 */
export function computeDeckDifficulty(
  globalDifficulty: Difficulty,
  deckId: string,
  tags: string[],
  isOxford3000: boolean,
): Difficulty {
  switch (deckId) {
    case 'deck-daily-high-frequency':
      // 日常高频：词频越高越简单
      return globalDifficulty;
    case 'deck-cet4':
      // 四级词库：Oxford 3000 和 CET4 标签词为简单
      if (isOxford3000 || tags.includes('cet4')) return globalDifficulty <= 2 ? 1 : 2;
      return globalDifficulty;
    case 'deck-cet6':
      // 六级词库：CET6 标签词为中等，CET4 重叠词为简单
      if (isOxford3000) return 1;
      if (tags.includes('cet4') && !tags.includes('cet6')) return 2;
      if (tags.includes('cet6')) return 3;
      return 4;
    default:
      return globalDifficulty;
  }
}

/** 功能词列表：不适合作为学习内容的超高频虚词。 */
const FUNCTION_WORDS = new Set([
  'the',
  'be',
  'to',
  'of',
  'and',
  'a',
  'in',
  'that',
  'have',
  'i',
  'it',
  'for',
  'not',
  'on',
  'with',
  'he',
  'as',
  'you',
  'do',
  'at',
  'this',
  'but',
  'his',
  'by',
  'from',
  'they',
  'we',
  'say',
  'her',
  'she',
  'or',
  'an',
  'will',
  'my',
  'one',
  'all',
  'would',
  'there',
  'their',
  'what',
  'so',
  'up',
  'out',
  'if',
  'about',
  'who',
  'get',
  'which',
  'go',
  'me',
  'when',
  'make',
  'can',
  'like',
  'time',
  'no',
  'just',
  'him',
  'know',
  'take',
  'people',
  'into',
  'year',
  'your',
  'good',
  'some',
  'could',
  'them',
  'see',
  'other',
  'than',
  'then',
  'now',
  'look',
  'only',
  'come',
  'its',
  'over',
  'think',
  'also',
  'back',
  'after',
  'use',
  'two',
  'how',
  'our',
  'work',
  'first',
  'well',
  'way',
  'even',
  'new',
  'want',
  'because',
  'any',
  'these',
  'give',
  'day',
  'most',
  'us',
  'shall',
  'been',
  'has',
  'had',
  'may',
  'am',
  'are',
  'is',
  'was',
  'were',
  'being',
  'does',
  'did',
  'doing',
  'each',
  'those',
  'very',
  'much',
  'many',
  'more',
  'own',
  'same',
  'still',
]);

/** 判断是否为功能词。 */
export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word.toLowerCase().trim());
}

/** 判断是否为合法学习词（字母组成、有长度、非功能词）。 */
export function isValidLearningWord(word: string): boolean {
  const trimmed = word.trim();
  return /^[a-zA-Z]+$/.test(trimmed) && trimmed.length >= 2 && !isFunctionWord(trimmed);
}
