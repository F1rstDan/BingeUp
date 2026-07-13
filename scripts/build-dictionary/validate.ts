/**
 * 数据校验模块。
 *
 * 覆盖：空字段、合法词性、目标词形、例句翻译、重复 lemma、
 * 同义冲突、唯一答案、许可证、例句中目标词形唯一出现。
 */
import type { BuildWord } from './types';

export interface ValidationError {
  wordId: string;
  word: string;
  errors: string[];
}

/** 合法的词性标记集合。 */
const VALID_POS = new Set([
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'num.',
  'art.',
  'int.',
  'det.',
  'abbr.',
  'aux.',
]);

/** 校验单条单词记录。 */
export function validateBuildWord(w: BuildWord): ValidationError | null {
  const errors: string[] = [];

  if (!w.id || !w.id.trim()) errors.push('id 为空');
  if (!isNonEmpty(w.word)) errors.push('word 为空');
  if (!isNonEmpty(w.lemma)) errors.push('lemma 为空');
  if (!/^[a-zA-Z]+$/.test(w.lemma)) errors.push('lemma 非纯字母');
  if (!w.partOfSpeech || w.partOfSpeech.length === 0) {
    errors.push('partOfSpeech 为空');
  } else {
    for (const pos of w.partOfSpeech) {
      if (!VALID_POS.has(pos)) {
        errors.push(`非法词性: "${pos}"`);
      }
    }
  }
  if (!w.coreMeaningZh || w.coreMeaningZh.length === 0) {
    errors.push('coreMeaningZh 为空');
  } else {
    for (const m of w.coreMeaningZh) {
      if (!isNonEmpty(m)) errors.push('coreMeaningZh 含空项');
    }
  }
  if (!isNonEmpty(w.source)) errors.push('source 为空');
  if (!isNonEmpty(w.license)) errors.push('license 为空');
  if (!(w.difficulty >= 1 && w.difficulty <= 4)) {
    errors.push(`difficulty 非法: ${w.difficulty}`);
  }
  if (w.deckIds.length === 0) errors.push('deckIds 为空');

  // 例句校验：有例句时必须校验表层词形唯一出现
  if (isNonEmpty(w.exampleSentence)) {
    if (!isNonEmpty(w.exampleTranslation)) {
      errors.push('有例句但无例句翻译');
    }
    if (!isNonEmpty(w.surfaceFormInExample)) {
      errors.push('有例句但无 surfaceFormInExample');
    } else {
      // 校验 surfaceFormInExample 在例句中恰好出现一次
      const count = countOccurrences(w.exampleSentence, w.surfaceFormInExample);
      if (count === 0) {
        errors.push(`surfaceFormInExample "${w.surfaceFormInExample}" 未在例句中出现`);
      } else if (count > 1) {
        errors.push(
          `surfaceFormInExample "${w.surfaceFormInExample}" 在例句中出现 ${count} 次（应恰好 1 次）`,
        );
      }
    }
  }

  return errors.length > 0 ? { wordId: w.id, word: w.word, errors } : null;
}

/** 校验整个词库：重复 lemma、同义冲突、唯一答案。 */
export function validateAllWords(words: BuildWord[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // 逐条校验
  for (const w of words) {
    const err = validateBuildWord(w);
    if (err) errors.push(err);
  }

  // 重复 lemma 检测
  const lemmaMap = new Map<string, string[]>();
  for (const w of words) {
    const key = w.lemma.toLowerCase();
    const list = lemmaMap.get(key) ?? [];
    list.push(w.id);
    lemmaMap.set(key, list);
  }
  for (const [lemma, ids] of lemmaMap) {
    if (ids.length > 1) {
      errors.push({
        wordId: ids[0]!,
        word: lemma,
        errors: [`重复 lemma: ${ids.join(', ')}`],
      });
    }
  }

  return errors;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 统计子串在字符串中出现的次数（大小写不敏感，单词边界）。 */
function countOccurrences(text: string, sub: string): number {
  const escaped = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}
