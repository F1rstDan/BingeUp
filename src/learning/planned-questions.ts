import type {
  MultipleChoiceQuestion,
  QuestionExplanation,
  SpellingQuestion,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import { contextPrompt, primaryMeaning, primaryPartOfSpeech } from '@/learning/content-hash';

/** 内容包无法为到期卡提供可用题组时抛出；调用方必须恢复视频并显示错误。 */
export class ContentUnavailableError extends Error {
  readonly code = 'content-unavailable';

  constructor(
    readonly wordId: string,
    message = `内容不可用：${wordId}`,
  ) {
    super(message);
    this.name = 'ContentUnavailableError';
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    if (i !== j) {
      const current = result[i]!;
      result[i] = result[j]!;
      result[j] = current;
    }
  }
  return result;
}

function explanationFor(word: WordRecord): QuestionExplanation {
  return {
    word: word.word,
    phonetic: word.phonetic,
    partOfSpeech: [...word.partOfSpeech],
    meanings: [...word.coreMeaningZh],
    secondaryMeanings: word.secondaryMeanings?.map((item) => ({ ...item })),
    exampleSentence: word.exampleSentence,
    exampleTranslation: word.exampleTranslation,
  };
}

function requireWord(id: string, wordsById: Map<string, WordRecord>): WordRecord {
  const word = wordsById.get(id);
  if (!word) throw new Error(`固定题组引用不存在的单词：${id}`);
  return word;
}

function buildChoice(
  type: 'en-to-zh' | 'zh-to-en',
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  cardId: string,
  random: () => number,
): MultipleChoiceQuestion {
  const set = type === 'en-to-zh' ? plan.enToZh : plan.zhToEn;
  if (!set) throw new ContentUnavailableError(target.id, `缺少 ${type} 题组`);
  const distractors = set.distractors.map((id) => requireWord(id, wordsById));
  const correctAnswer = type === 'en-to-zh' ? primaryMeaning(target) : target.word;
  const options = shuffle(
    [
      correctAnswer,
      ...(type === 'en-to-zh'
        ? distractors.map(primaryMeaning)
        : distractors.map((word) => word.word)),
    ],
    random,
  );
  return {
    id: crypto.randomUUID(),
    type,
    cardId,
    wordId: target.id,
    prompt: type === 'en-to-zh' ? target.word : primaryMeaning(target),
    options,
    correctIndex: options.indexOf(correctAnswer),
    explanation: explanationFor(target),
  };
}

export function generatePlannedEnToZh(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  cardId: string,
  random: () => number = Math.random,
): MultipleChoiceQuestion {
  return buildChoice('en-to-zh', target, plan, wordsById, cardId, random);
}

export function generatePlannedZhToEn(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  cardId: string,
  random: () => number = Math.random,
): MultipleChoiceQuestion {
  return buildChoice('zh-to-en', target, plan, wordsById, cardId, random);
}

export function generatePlannedContextChoice(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  cardId: string,
  random: () => number = Math.random,
): MultipleChoiceQuestion {
  if (!plan.contextChoice) throw new ContentUnavailableError(target.id, '缺少语境题组');
  const prompt = contextPrompt(target);
  if (!prompt || !prompt.includes('____')) {
    throw new ContentUnavailableError(target.id, '语境题原文不可用');
  }
  const correctAnswer = target.surfaceFormInExample;
  if (!correctAnswer) throw new ContentUnavailableError(target.id, '语境题缺少目标表层词形');
  for (const distractor of plan.contextChoice.distractors) {
    requireWord(distractor.wordId, wordsById);
  }
  const options = shuffle(
    [correctAnswer, ...plan.contextChoice.distractors.map((item) => item.surfaceForm)],
    random,
  );
  return {
    id: crypto.randomUUID(),
    type: 'context-choice',
    cardId,
    wordId: target.id,
    prompt,
    options,
    correctIndex: options.indexOf(correctAnswer),
    explanation: explanationFor(target),
  };
}

export function generatePlannedSpelling(
  target: WordRecord,
  plan: WordQuestionPlan,
  cardId: string,
): SpellingQuestion {
  if (!plan.spelling) throw new ContentUnavailableError(target.id, '缺少拼写计划');
  const length = [...target.word].length;
  const prefix = target.word.slice(0, plan.spelling.prefixLength);
  return {
    id: crypto.randomUUID(),
    type: 'spelling',
    cardId,
    wordId: target.id,
    prompt: primaryMeaning(target),
    correctAnswer: target.word,
    hint: {
      partOfSpeech: primaryPartOfSpeech(target),
      exampleSentence: contextPrompt(target),
      prefix,
      letterCount: length,
    },
    explanation: explanationFor(target),
  };
}
