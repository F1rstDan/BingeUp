import type { WordRecord, MultipleChoiceQuestion } from '@/types';

/** 将单词的核心中文释义连接为选项文本。 */
export function meaningText(word: WordRecord): string {
  return word.coreMeaningZh.join('；');
}

export interface GenerateQuestionInput {
  targetWord: WordRecord;
  /** 干扰词候选池，至少三个有效项（与目标释义不同的）。 */
  distractors: WordRecord[];
  cardId: string;
  /** 可选的随机函数，默认 Math.random，便于测试注入。 */
  random?: () => number;
}

const REQUIRED_DISTRACTORS = 3;

/**
 * Fisher-Yates 打乱：使用注入的随机函数，in-place 修改数组。
 */
function shuffle<T>(arr: T[], random: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    if (i !== j) {
      const tmp = result[i]!;
      result[i] = result[j]!;
      result[j] = tmp;
    }
  }
  return result;
}

/**
 * 生成英文选中文选择题（Issue #5 验收标准 2）。
 *
 * 规则：
 * - 四个选项互不重复；
 * - 只有一个正确答案，即目标单词的核心释义；
 * - 干扰项释义与目标相同时自动过滤；
 * - 正确答案位置随机打乱。
 */
export function generateEnToZhQuestion(input: GenerateQuestionInput): MultipleChoiceQuestion {
  const { targetWord, distractors, cardId } = input;
  const random = input.random ?? Math.random;

  const correctText = meaningText(targetWord);

  // 过滤掉与目标释义相同的干扰项，并去重
  const seen = new Set<string>([correctText]);
  const validDistractors: string[] = [];
  for (const d of distractors) {
    const text = meaningText(d);
    if (!seen.has(text)) {
      seen.add(text);
      validDistractors.push(text);
    }
    if (validDistractors.length === REQUIRED_DISTRACTORS) {
      break;
    }
  }

  if (validDistractors.length < REQUIRED_DISTRACTORS) {
    throw new Error(
      `干扰项不足：需要 ${REQUIRED_DISTRACTORS} 个，实际有效 ${validDistractors.length} 个`,
    );
  }

  const options = shuffle([correctText, ...validDistractors], random);
  const correctIndex = options.indexOf(correctText);

  return {
    id: crypto.randomUUID(),
    type: 'en-to-zh',
    cardId,
    wordId: targetWord.id,
    prompt: targetWord.word,
    options,
    correctIndex,
    explanation: {
      word: targetWord.word,
      phonetic: targetWord.phonetic,
      partOfSpeech: [...targetWord.partOfSpeech],
      meanings: [...targetWord.coreMeaningZh],
      exampleSentence: targetWord.exampleSentence,
      exampleTranslation: targetWord.exampleTranslation,
    },
  };
}
