import type {
  AppSettings,
  CardRecord,
  LearningItem,
  MultipleChoiceQuestion,
  ReviewLogRecord,
  SessionLogRecord,
  SiteSettings,
  SpellingQuestion,
  SubmissionResult,
  WordRecord,
} from '@/types';
import type { PopupLearningStats } from '@/messaging/messages';
import type { DevDataSnapshot, DevDeckSummary } from '@/dev-tools/messages';

import { DEFAULT_SETTINGS } from '@/settings/defaults';

/**
 * 预览页演示数据（真实类型 + 与内置词库一致的字段形态）。
 *
 * 数据只服务人工查看与批注：词形、音标、例句取自内置示例词库的同名单词，
 * 时间戳按“今天/最近七天”相对生成，保证统计页、遮罩与 Popup 都能呈现非空状态。
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function localDayStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const DEMO_WORDS: Record<string, WordRecord> = {
  deliberate: {
    id: 'w-deliberate',
    word: 'deliberate',
    lemma: 'deliberate',
    phonetic: '/dɪˈlɪbərət/',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['故意的；深思熟虑的'],
    exampleSentence: 'His silence was a deliberate choice.',
    exampleTranslation: '他的沉默是深思熟虑的选择。',
    surfaceFormInExample: 'deliberate',
    difficulty: 3,
    frequencyRank: 3,
    source: 'BingeUp built-in sample',
    license: 'CC0-1.0',
  },
  enhance: {
    id: 'w-enhance',
    word: 'enhance',
    lemma: 'enhance',
    phonetic: '/ɪnˈhɑːns/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['提高；增强'],
    exampleSentence: 'Music can enhance the mood of a film.',
    exampleTranslation: '音乐能增强电影的氛围。',
    surfaceFormInExample: 'enhance',
    difficulty: 2,
    frequencyRank: 2,
    source: 'BingeUp built-in sample',
    license: 'CC0-1.0',
  },
  mitigate: {
    id: 'w-mitigate',
    word: 'mitigate',
    lemma: 'mitigate',
    phonetic: '/ˈmɪtɪɡeɪt/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['减轻；缓和'],
    exampleSentence: 'We planted trees to mitigate noise pollution.',
    exampleTranslation: '我们种树来减轻噪音污染。',
    surfaceFormInExample: 'mitigate',
    difficulty: 4,
    frequencyRank: 4,
    source: 'BingeUp built-in sample',
    license: 'CC0-1.0',
  },
};

export function demoWord(key: keyof typeof DEMO_WORDS): WordRecord {
  const word = DEMO_WORDS[key];
  if (word === undefined) throw new Error(`演示单词不存在：${key}`);
  return { ...word };
}

/** 新词展示（单题模式与连续模式共用同一数据形态）。 */
export function makeDemoNewWordItem(): LearningItem {
  const word = demoWord('deliberate');
  return {
    kind: 'new-word-presentation',
    presentation: {
      word: {
        ...word,
        secondaryMeanings: [{ partOfSpeech: 'v.', meaningZh: '仔细考虑' }],
      },
    },
  };
}

/** 选择题：英文选中文，示例形态与 question-generator 的输出字段一致。 */
export function makeDemoChoiceQuestion(): MultipleChoiceQuestion {
  const word = demoWord('deliberate');
  return {
    id: 'demo-question-choice-1',
    type: 'en-to-zh',
    cardId: 'demo-card-deliberate',
    wordId: word.id,
    prompt: word.word,
    options: ['故意的；深思熟虑的', '提高；增强', '减轻；缓和', '频繁的；经常的'],
    correctIndex: 0,
    explanation: {
      word: word.word,
      phonetic: word.phonetic,
      partOfSpeech: word.partOfSpeech,
      meanings: word.coreMeaningZh,
      exampleSentence: word.exampleSentence,
      exampleTranslation: word.exampleTranslation,
      secondaryMeanings: [{ partOfSpeech: 'v.', meaningZh: '仔细考虑' }],
    },
  };
}

/** 语境题：例句挖空，选项为句中应填入的英文词形。 */
export function makeDemoContextChoiceQuestion(): MultipleChoiceQuestion {
  const word = demoWord('deliberate');
  return {
    id: 'demo-question-context-1',
    type: 'context-choice',
    cardId: 'demo-card-deliberate',
    wordId: word.id,
    prompt: 'His silence was a ____ choice.',
    options: ['deliberate', 'enhance', 'mitigate', 'frequent'],
    correctIndex: 0,
    explanation: {
      word: word.word,
      phonetic: word.phonetic,
      partOfSpeech: word.partOfSpeech,
      meanings: word.coreMeaningZh,
      exampleSentence: word.exampleSentence,
      exampleTranslation: word.exampleTranslation,
      secondaryMeanings: [{ partOfSpeech: 'v.', meaningZh: '仔细考虑' }],
    },
  };
}

/** 拼写题：中文释义 → 英文词形（仅连续学习模式出现）。 */
export function makeDemoSpellingQuestion(): SpellingQuestion {
  const word = demoWord('mitigate');
  return {
    id: 'demo-question-spelling-1',
    type: 'spelling',
    cardId: 'demo-card-mitigate',
    wordId: word.id,
    prompt: word.coreMeaningZh.join('；'),
    correctAnswer: word.word,
    acceptableAnswers: [word.word],
    explanation: {
      word: word.word,
      phonetic: word.phonetic,
      partOfSpeech: word.partOfSpeech,
      meanings: word.coreMeaningZh,
      exampleSentence: word.exampleSentence,
      exampleTranslation: word.exampleTranslation,
    },
  };
}

/** 提交结果（评分纠正与“上一题反馈”演示共用）。 */
export function makeDemoSubmissionResult(
  question: MultipleChoiceQuestion | SpellingQuestion,
  isCorrect: boolean,
): SubmissionResult {
  const isSpelling = 'correctAnswer' in question;
  return {
    isCorrect,
    correctIndex: isSpelling ? undefined : question.correctIndex,
    correctAnswer: isSpelling ? question.correctAnswer : question.options[question.correctIndex]!,
    submittedAnswer: isCorrect
      ? undefined
      : isSpelling
        ? 'wrong'
        : question.options[(question.correctIndex + 1) % question.options.length],
    cardId: question.cardId,
    reviewLogId: `demo-review-log-${Date.now()}`,
    explanation: question.explanation,
    rating: isCorrect ? 'good' : 'again',
    nextReviewAt: Date.now() + (isCorrect ? 2 * DAY : 10 * 60 * 1000),
  };
}

/** 设置页演示设置（默认设置 + 一处可见差异，便于确认“保存/恢复默认”链路）。 */
export const DEMO_APP_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  spellingEnabled: true,
};

export const DEMO_SITE_SETTINGS: Record<string, SiteSettings> = {
  'bilibili.com': { enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
  'youtube.com': { enabled: false, mode: 'full-adaptation', firstQuestionPending: false },
  'example.com': {
    enabled: true,
    mode: 'basic-web',
    firstQuestionPending: false,
    pageLoadTrigger: true,
    scrollTrigger: false,
  },
};

/** Popup 今日学习指标（非空数据）。 */
export function makeDemoPopupStats(): PopupLearningStats {
  return {
    today: {
      completedQuestions: 7,
      reviewedWords: 4,
      newWords: 1,
      continuousSessions: 2,
      continuousQuestions: 5,
      longTermCompleted: 3,
      longTermAccuracy: 0.67,
    },
    dueReviewCount: 4,
  };
}

/** 开发工具（Popup 开发数据面板）摘要，in-dev 行为与真实后台一致。 */
export const DEMO_DEV_DECK_SUMMARY: DevDeckSummary = {
  deck: { id: 'deck-daily-high-frequency', name: '日常高频' },
  wordCount: 12,
  learningCardCount: 5,
  stageCounts: { new: 1, 'short-term': 2, 'long-term': 1, 'self-reported-known': 1 },
};

/** 开发工具数据快照（结构与 DevDataSnapshot 一致）。 */
export const DEMO_DEV_SNAPSHOT: DevDataSnapshot = {
  cards: [
    {
      id: 'demo-card-deliberate',
      wordId: 'w-deliberate',
      deckId: 'deck-daily-high-frequency',
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: Date.now() - 6 * DAY,
      updatedAt: Date.now() - 2 * HOUR,
      nextReviewAt: Date.now() - HOUR,
      schedulerState: {
        stability: 12.4,
        difficulty: 4.6,
        reps: 5,
        lapses: 1,
        state: 2,
        scheduledDays: 3,
        learningSteps: 0,
        lastReviewAt: Date.now() - 2 * HOUR,
      },
    } satisfies CardRecord,
  ],
  reviewLogs: [
    {
      id: 'demo-log-1',
      cardId: 'demo-card-deliberate',
      wordId: 'w-deliberate',
      questionType: 'en-to-zh',
      selectedAnswer: '故意的；深思熟虑的',
      correctAnswer: '故意的；深思熟虑的',
      isCorrect: true,
      responseTimeMs: 3200,
      reviewedAt: Date.now() - 30 * 60 * 1000,
      stageAtSubmission: 'long-term',
      source: 'natural',
      rating: 'good',
    } satisfies ReviewLogRecord,
  ],
  sessionLogs: [
    {
      id: 'demo-session-1',
      startedAt: Date.now() - 55 * 60 * 1000,
      endedAt: Date.now() - 45 * 60 * 1000,
      mode: 'continuous',
      outcome: 'submitted',
      questionsAnswered: 2,
      source: 'manual',
      continuousQuestionsAnswered: 2,
    } satisfies SessionLogRecord,
  ],
};

export { DEMO_WORDS, localDayStart, DAY, HOUR };
