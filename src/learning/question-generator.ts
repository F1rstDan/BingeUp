import type {
  CardStage,
  QuestionType,
  WordRecord,
  MultipleChoiceQuestion,
  SpellingQuestion,
} from '@/types';

/** 将单词的核心中文释义连接为选项文本。 */
export function meaningText(word: WordRecord): string {
  return word.coreMeaningZh.join('；');
}

export interface GenerateQuestionInput {
  targetWord: WordRecord;
  /** 干扰词候选池，至少三个词形和释义均不同的有效项。 */
  distractors: WordRecord[];
  cardId: string;
  /** 可选的随机函数，默认 Math.random，便于测试注入。 */
  random?: () => number;
}

const REQUIRED_DISTRACTORS = 3;

/**
 * Fisher-Yates 打乱：使用注入的随机函数，返回打乱后的副本。
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
 * 按词性相似度评分干扰项（Issue #7 验收标准 2：符合词性的干扰项）。
 *
 * 优先选择与目标词共享至少一个词性的干扰项；其次选词性数量相同的；
 * 其余候选的优先级最低。返回评分越小越优先。
 */
function scoreByPartOfSpeech(target: WordRecord, candidate: WordRecord): number {
  const shared = target.partOfSpeech.some((p) => candidate.partOfSpeech.includes(p));
  if (shared) return 0;
  if (target.partOfSpeech.length === candidate.partOfSpeech.length) return 1;
  return 2;
}

/**
 * 按难度相似度评分干扰项（Issue #7 验收标准 2：符合难度的干扰项）。
 * 难度差越小评分越低（越优先）。
 */
function scoreByDifficulty(target: WordRecord, candidate: WordRecord): number {
  return Math.abs(target.difficulty - candidate.difficulty);
}

/**
 * 选取符合词性/难度的干扰词（Issue #7 验收标准 2）。
 *
 * 规则：
 * - 排除目标词自身、同词形（含例句表层词形）和同释义项；
 * - 优先选择与目标词共享词性、难度相近的词；
 * - 同分候选随机选取，结果按词形和释义去重；
 * - 相似候选不足时，继续选取排名靠后的有效词。
 */
export function pickDistractors(
  targetWord: WordRecord,
  pool: WordRecord[],
  count: number = REQUIRED_DISTRACTORS,
  random: () => number = Math.random,
): WordRecord[] {
  const seenIds = new Set([targetWord.id]);
  const seenWords = new Set(
    [targetWord.word, targetWord.surfaceFormInExample ?? '', ''].map((word) =>
      word.trim().toLowerCase(),
    ),
  );
  const seenMeanings = new Set([meaningText(targetWord).trim(), '']);
  const candidates = pool.filter(
    (word) =>
      !seenIds.has(word.id) &&
      !seenWords.has(word.word.trim().toLowerCase()) &&
      !seenMeanings.has(meaningText(word).trim()),
  );
  // 稳定排序保留打乱后的同分顺序，避免总是选中原始词库的开头。
  const scored = shuffle(candidates, random)
    .map((w) => ({
      word: w,
      posScore: scoreByPartOfSpeech(targetWord, w),
      diffScore: scoreByDifficulty(targetWord, w),
    }))
    .sort((a, b) => a.posScore - b.posScore || a.diffScore - b.diffScore);
  const picked: WordRecord[] = [];
  for (const { word } of scored) {
    if (picked.length >= count) break;
    const wordForm = word.word.trim().toLowerCase();
    const meaning = meaningText(word).trim();
    if (seenIds.has(word.id) || seenWords.has(wordForm) || seenMeanings.has(meaning)) {
      continue;
    }
    seenIds.add(word.id);
    seenWords.add(wordForm);
    seenMeanings.add(meaning);
    picked.push(word);
  }
  return picked;
}

/**
 * 构建题目解释信息（三类题型共用）。
 */
function buildExplanation(word: WordRecord) {
  return {
    word: word.word,
    phonetic: word.phonetic,
    partOfSpeech: [...word.partOfSpeech],
    meanings: [...word.coreMeaningZh],
    exampleSentence: word.exampleSentence,
    exampleTranslation: word.exampleTranslation,
  };
}

/**
 * 生成英文选中文选择题（Issue #5 验收标准 2 / Issue #7 验收标准 2）。
 *
 * 规则：
 * - 四个选项互不重复；
 * - 只有一个正确答案，即目标单词的核心释义；
 * - 干扰项释义与目标相同时自动过滤；
 * - 干扰项按词性/难度优先选取；
 * - 正确答案位置随机打乱。
 */
export function generateEnToZhQuestion(input: GenerateQuestionInput): MultipleChoiceQuestion {
  const { targetWord, distractors, cardId } = input;
  const random = input.random ?? Math.random;

  const correctText = meaningText(targetWord);
  const validDistractors = pickDistractors(
    targetWord,
    distractors,
    REQUIRED_DISTRACTORS,
    random,
  ).map(meaningText);

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
    explanation: buildExplanation(targetWord),
  };
}

/**
 * 生成中文选英文选择题（Issue #7 验收标准 2）。
 *
 * 规则：
 * - 题干是目标词的核心中文释义；
 * - 四个选项为英文词形，互不重复；
 * - 只有一个正确答案；
 * - 干扰项按词性/难度优先选取。
 */
export function generateZhToEnQuestion(input: GenerateQuestionInput): MultipleChoiceQuestion {
  const { targetWord, distractors, cardId } = input;
  const random = input.random ?? Math.random;

  const correctText = targetWord.word;
  const validDistractors = pickDistractors(
    targetWord,
    distractors,
    REQUIRED_DISTRACTORS,
    random,
  ).map((word) => word.word);

  if (validDistractors.length < REQUIRED_DISTRACTORS) {
    throw new Error(
      `干扰项不足：需要 ${REQUIRED_DISTRACTORS} 个，实际有效 ${validDistractors.length} 个`,
    );
  }

  const options = shuffle([correctText, ...validDistractors], random);
  const correctIndex = options.indexOf(correctText);

  return {
    id: crypto.randomUUID(),
    type: 'zh-to-en',
    cardId,
    wordId: targetWord.id,
    prompt: meaningText(targetWord),
    options,
    correctIndex,
    explanation: buildExplanation(targetWord),
  };
}

/**
 * 生成例句语境选择题（Issue #7 验收标准 2 / Issue #25）。
 *
 * 规则：
 * - 题干是目标词的例句，目标词位置替换为 ____；
 * - 四个选项为英文词形，互不重复；
 * - 正确答案使用 surfaceFormInExample（表层词形），而非 lemma，
 *   确保时态、单复数等与空位一致；
 * - 干扰项按词性/难度优先选取（确保填入后语法合理）。
 */
export function generateContextChoiceQuestion(
  input: GenerateQuestionInput,
): MultipleChoiceQuestion {
  const { targetWord, distractors, cardId } = input;
  const random = input.random ?? Math.random;

  // 使用 surfaceFormInExample 作为正确答案（Issue #25）
  const correctText = targetWord.surfaceFormInExample || targetWord.word;
  const validDistractors = pickDistractors(
    targetWord,
    distractors,
    REQUIRED_DISTRACTORS,
    random,
  ).map((word) => word.word);

  if (validDistractors.length < REQUIRED_DISTRACTORS) {
    throw new Error(
      `干扰项不足：需要 ${REQUIRED_DISTRACTORS} 个，实际有效 ${validDistractors.length} 个`,
    );
  }

  const options = shuffle([correctText, ...validDistractors], random);
  const correctIndex = options.indexOf(correctText);

  // 将例句中的目标词替换为 ____，构造语境题干
  const escaped = correctText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prompt = (targetWord.exampleSentence ?? '').replace(
    new RegExp(`\\b${escaped}\\b`, 'i'),
    '____',
  );

  return {
    id: crypto.randomUUID(),
    type: 'context-choice',
    cardId,
    wordId: targetWord.id,
    prompt,
    options,
    correctIndex,
    explanation: buildExplanation(targetWord),
  };
}

/**
 * 生成拼写题（Issue #8 验收标准 3）。
 *
 * 规则：
 * - 题干是目标词的核心中文释义；
 * - 用户需输入英文词形；
 * - 正确答案为目标词的词形；
 * - 拼写题仅用于连续学习模式。
 */
export function generateSpellingQuestion(input: GenerateQuestionInput): SpellingQuestion {
  const { targetWord, cardId } = input;

  return {
    id: crypto.randomUUID(),
    type: 'spelling',
    cardId,
    wordId: targetWord.id,
    prompt: meaningText(targetWord),
    correctAnswer: targetWord.word,
    explanation: buildExplanation(targetWord),
  };
}

/**
 * 根据学习阶段选择题型（Issue #7 验收标准 2 / Issue #1 用户故事 32）。
 *
 * - short-term / self-reported-known：en-to-zh（首次接触，英文→中文最易）；
 * - long-term（reps 0-1）：zh-to-en（中文→英文，难度提升）；
 * - long-term（reps >= 2）：context-choice（例句语境，难度最高）。
 *
 * 返回的题型用于调用对应的生成器。拼写题由连续学习模式单独处理，不由此函数返回。
 */
export function chooseQuestionType(stage: CardStage, schedulerReps?: number): QuestionType {
  if (stage !== 'long-term') {
    return 'en-to-zh';
  }
  const reps = schedulerReps ?? 0;
  if (reps < 2) {
    return 'zh-to-en';
  }
  return 'context-choice';
}
