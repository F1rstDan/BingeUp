import type { ContextChoiceDistractor, QuestionType, SecondaryMeaning, WordRecord } from '@/types';

/** 题组模板版本；模板或可见文本规则改变时必须提升。 */
export const QUESTION_TEMPLATE_VERSION = 'fixed-question-v1';

/** 生成和检查题组时共用的引用词条快照。 */
export interface QuestionReference {
  wordId: string;
  word: string;
  partOfSpeech: string[];
  coreMeaningZh: string[];
  secondaryMeanings?: SecondaryMeaning[];
  exampleSentence?: string;
  exampleTranslation?: string;
  surfaceFormInExample?: string;
}

export interface QuestionHashInput {
  type: QuestionType;
  templateVersion: string;
  prompt: string;
  partOfSpeech: string;
  correctAnswer: string;
  /** 规范顺序：正确答案在前，三个干扰项随后。 */
  options: string[];
  /** 规范顺序：目标词在前，与 options 中干扰项一一对应。 */
  references: QuestionReference[];
  spellingHint?: {
    prefix: string;
    letterCount: number;
  };
}

/** 稳定 JSON：对象键递归排序，数组保持顺序。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256（UTF-8）。浏览器扩展与 Node 构建脚本共用。 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashQuestionInput(input: QuestionHashInput): Promise<string> {
  return sha256Hex(canonicalJson(input));
}

export function primaryMeaning(word: WordRecord | QuestionReference): string {
  return word.coreMeaningZh[0] ?? '';
}

export function primaryPartOfSpeech(word: WordRecord | QuestionReference): string {
  return word.partOfSpeech[0] ?? '';
}

export function referenceFor(word: WordRecord | QuestionReference): QuestionReference {
  return {
    wordId: 'id' in word ? word.id : word.wordId,
    word: word.word,
    partOfSpeech: [...word.partOfSpeech],
    coreMeaningZh: [...word.coreMeaningZh],
    secondaryMeanings: word.secondaryMeanings?.map((item) => ({ ...item })),
    exampleSentence: word.exampleSentence,
    exampleTranslation: word.exampleTranslation,
    surfaceFormInExample: word.surfaceFormInExample,
  };
}

/** 题型可见题面。POS 由界面单独渲染，但参与哈希。 */
export function questionPromptFor(
  type: QuestionType,
  target: WordRecord | QuestionReference,
): string {
  switch (type) {
    case 'en-to-zh':
      return target.word;
    case 'zh-to-en':
    case 'spelling':
      return primaryMeaning(target);
    case 'context-choice':
      return contextPrompt(target);
  }
}

/** 把例句中恰好一次的目标表层词形替换为固定空位。 */
export function contextPrompt(target: WordRecord | QuestionReference): string {
  const sentence = target.exampleSentence ?? '';
  const surface = target.surfaceFormInExample ?? '';
  if (!sentence || !surface) return '';
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '____');
}

export function spellingHintFor(target: WordRecord | QuestionReference, prefixLength: number) {
  const word = target.word;
  return {
    prefix: word.slice(0, prefixLength),
    letterCount: [...word].length,
  };
}

export function contextDistractorFor(wordId: string, surfaceForm: string): ContextChoiceDistractor {
  return { wordId, surfaceForm };
}
