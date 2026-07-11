/**
 * 刷刷升级共享领域类型。术语遵循 CONTEXT.md。
 */

/** 网站兼容等级（CONTEXT.md：完整适配 / 通用视频模式 / 基础网页模式 / 不支持）。_Avoid_: official */
export type SiteMode = 'full-adaptation' | 'generic-video' | 'basic-web' | 'unsupported';

/** 遮罩覆盖方式 */
export type OverlayMode = 'video-region' | 'full-page';

/** 学习模式 */
export type LearningMode = 'single' | 'continuous';

/** 全局冷却状态：只持久化这两个字段（见规格 Implementation Decisions）。 */
export interface CooldownState {
  /** 下次允许触发的时间戳（ms）。 */
  nextAllowedAt: number;
  /** 连续跳过次数。正常完成题目后清零。 */
  consecutiveSkipCount: number;
}

/** 站点设置 */
export interface SiteSettings {
  enabled: boolean;
  mode: SiteMode;
  /** 首次触发是否仍待处理。 */
  firstQuestionPending: boolean;
  /**
   * 跳过引导后的有限启用提示拒绝次数（Issue #9 AC2）。
   * 达到 MAX_PROMPT_DECLINES（2）后不再主动提示。undefined 视为 0。
   */
  promptDeclineCount?: number;
}

/** 应用设置（第一条纵向切片只用到冷却相关字段；其余字段由后续 Issue 引入）。 */
export interface AppSettings {
  defaultCooldownMinutes: number;
  consecutiveSkipCooldowns: number[];
  /** 每日新词上限：一个本地自然日内通过“知道了”接受的新词数量上限（CONTEXT.md）。 */
  dailyNewWordLimit: number;
}

/** 视频播放快照：用于在交互后恢复正确播放状态。 */
export interface PlaybackSnapshot {
  wasPlaying: boolean;
  currentTime: number;
  playbackRate: number;
}

/** 视频变化事件：由站点适配器发出。 */
export interface VideoChangeEvent {
  /** 视频身份标识；变化才视为新视频。 */
  identity: string;
  video: HTMLVideoElement | null;
  overlayTarget: HTMLElement | DOMRect | null;
  overlayMode: OverlayMode;
}

/** 用户在单题交互中的结果。 */
export type InteractionOutcome = 'submitted' | 'skipped';

// ─── 本地词库与学习卡基础（Issue #5） ─────────────────────────────

/** 题型：英文选中文 / 中文选英文 / 例句语境题 / 拼写题。 */
export type QuestionType = 'en-to-zh' | 'zh-to-en' | 'context-choice' | 'spelling';

// ─── 复习调度与评分（Issue #7） ───────────────────────────────────

/**
 * FSRS 评分等级（封装 ts-fsrs 的 Rating 枚举，学习代码不直接依赖 ts-fsrs）。
 * - `again`：答错，重新学习；
 * - `hard`：答对但费力/蒙对；
 * - `good`：正常答对；
 * - `easy`：轻松答对。
 */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

/**
 * 用户在反馈阶段的纠正评分（Issue #1 规格：其实是蒙的 / 这个太简单）。
 * - `guessed`：用户声明其实是蒙对的，应降低评分；
 * - `too-easy`：用户声明太简单，应提高评分。
 */
export type UserCorrection = 'guessed' | 'too-easy';

/**
 * 调度器状态：FSRS 内部记忆状态的领域投影（Issue #7 验收标准 4）。
 *
 * 学习代码通过 `ReviewSchedulerPort` 操作此状态，不直接引用 ts-fsrs 类型。
 * 字段语义与 ts-fsrs 的 Card 对应，但作为领域数据持久化。
 */
export interface SchedulerState {
  /** 记忆稳定性（FSRS stability）。 */
  stability: number;
  /** 难度（FSRS difficulty，范围 1-10）。 */
  difficulty: number;
  /** 已复习次数。 */
  reps: number;
  /** 遗忘次数（答错导致重新学习的次数）。 */
  lapses: number;
  /** FSRS 状态：0=New 1=Learning 2=Review 3=Relearning。 */
  state: number;
  /** 计划间隔天数。 */
  scheduledDays: number;
  /** 学习阶段步数。 */
  learningSteps: number;
  /** 上次复习时间戳（ms），首次为 undefined。 */
  lastReviewAt?: number;
}

/**
 * 学习卡来源（Issue #6）。
 * - `accepted-new`：用户在候选新词展示中选择“知道了”接受的新词；
 * - `self-reported`：用户选择“我认识，换一个”创建的自报认识词。
 * 旧记录可能缺少该字段，按 `accepted-new` 处理。
 */
export type CardOrigin = 'accepted-new' | 'self-reported';

/** 学习卡阶段：新词 / 短期学习词 / 长期复习词 / 自报认识词（术语见 CONTEXT.md）。 */
export type CardStage = 'new' | 'short-term' | 'long-term' | 'self-reported-known';

/** 单词记录：词库中的一条可学习内容，不包含用户进度。 */
export interface WordRecord {
  id: string;
  /** 词形（lemma）。 */
  word: string;
  lemma: string;
  phonetic?: string;
  /** 词性列表，至少一项。 */
  partOfSpeech: string[];
  /** 核心中文释义，至少一项。 */
  coreMeaningZh: string[];
  exampleSentence: string;
  exampleTranslation: string;
  difficulty: number;
  /** 数据来源标识，用于追溯。 */
  source: string;
  /** 许可证标识。 */
  license: string;
}

/** 词库记录：围绕某个学习目标整理的一组单词。 */
export interface DeckRecord {
  id: string;
  name: string;
  description?: string;
  source: string;
  license: string;
  wordIds: string[];
}

/** 学习卡：用户与一个单词之间唯一的学习关系。 */
export interface CardRecord {
  id: string;
  wordId: string;
  deckId: string;
  stage: CardStage;
  /** 该卡的来源（Issue #6）。旧记录缺省时按 `accepted-new` 处理。 */
  origin?: CardOrigin;
  createdAt: number;
  updatedAt: number;
  /**
   * 下次可测试/复习的时间戳（ms）。
   * - 短期学习词：接受后 now + 10 分钟（CONTEXT.md：最早十分钟后才可测试）；
   * - 自报认识词：创建后 1–2 天，验证题到期时间；
   * - 长期复习词：由 FSRS 调度（Issue #7）。undefined 表示暂不自动出题。
   */
  nextReviewAt?: number;
  /**
   * FSRS 调度器状态（Issue #7 验收标准 4）。
   * 仅在 stage === 'long-term' 时存在；由 ReviewSchedulerPort 管理，
   * 学习代码将其视为可持久化的不透明数据。
   */
  schedulerState?: SchedulerState;
  /**
   * 最近一次答错的时间戳（ms），用于优先级排序（Issue #7 验收标准 1）。
   * undefined 表示该长期复习词从未答错。
   */
  lastWrongAt?: number;
}

/** 复习日志：一次完成题目的判定记录。 */
export interface ReviewLogRecord {
  id: string;
  cardId: string;
  wordId: string;
  questionType: QuestionType;
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  reviewedAt: number;
  /**
   * 自动评分或用户纠正后的最终评分（Issue #7 验收标准 5）。
   * 旧日志可能缺省；按 `good` 处理。
   */
  rating?: ReviewRating;
  /** 用户纠正类型（Issue #7 验收标准 5）。未纠正时缺省。 */
  userCorrection?: UserCorrection;
  /** 提交前的选项切换次数（Issue #7 自动评分输入）。 */
  answerChanges?: number;
  /**
   * 本次评分前该学习卡的调度器状态（Issue #7 验收标准 5）。
   * 用于用户纠正评分时回滚到评分前状态并重新调度，避免重复推进。
   * undefined 表示本次评分前该卡尚未进入长期复习（init 而非 schedule）。
   */
  previousSchedulerState?: SchedulerState;
}

/** 题目解释：提交后展示给用户的单词详情。 */
export interface QuestionExplanation {
  word: string;
  phonetic?: string;
  partOfSpeech: string[];
  meanings: string[];
  exampleSentence?: string;
  exampleTranslation?: string;
}

/** 英文选中文选择题。每题只有一个正确答案，四个选项互不重复。 */
export interface MultipleChoiceQuestion {
  id: string;
  type: QuestionType;
  cardId: string;
  wordId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: QuestionExplanation;
}

/**
 * 拼写题：用户根据中文释义输入英文词形（Issue #8 验收标准 3）。
 * 仅用于连续学习模式；普通自然触发的单题模式不会出现拼写题。
 */
export interface SpellingQuestion {
  id: string;
  type: 'spelling';
  cardId: string;
  wordId: string;
  /** 题干：中文释义（用户据此拼写英文词）。 */
  prompt: string;
  /** 正确答案（英文词形）。 */
  correctAnswer: string;
  /** 可接受的其他正确形式（如词形变化），可选。 */
  acceptableAnswers?: string[];
  explanation: QuestionExplanation;
}

/** 统一题目类型：选择题或拼写题。 */
export type Question = MultipleChoiceQuestion | SpellingQuestion;

/** 新词展示：呈现候选新词的词形、释义和例句，不测试也不判分（CONTEXT.md：新词展示）。 */
export interface NewWordPresentation {
  word: WordRecord;
}

/**
 * 学习项目：一个自然触发点或连续学习一帧要呈现的内容。
 * - `new-word-presentation`：候选新词展示，不创建学习卡；
 * - `question`：针对已有学习卡的选择题（含验证题）；
 * - `spelling-question`：拼写题，仅连续学习模式（Issue #8 验收标准 3）。
 */
export type LearningItem =
  | { kind: 'new-word-presentation'; presentation: NewWordPresentation }
  | { kind: 'question'; question: MultipleChoiceQuestion }
  | { kind: 'spelling-question'; question: SpellingQuestion };

/** 提交选择题答案的内容。 */
export interface AnswerSubmission {
  question: MultipleChoiceQuestion;
  selectedIndex: number;
  responseTimeMs: number;
  /** 提交前的选项切换次数（Issue #7 自动评分输入，缺省 0）。 */
  answerChanges?: number;
}

/** 提交拼写题答案的内容（Issue #8 验收标准 3）。 */
export interface SpellingSubmission {
  question: SpellingQuestion;
  spelledAnswer: string;
  responseTimeMs: number;
  answerChanges?: number;
}

/** 提交后的判定结果（含可展开的学习信息，Issue #6 验收标准 5）。 */
export interface SubmissionResult {
  isCorrect: boolean;
  /** 选择题的正确选项索引；拼写题缺省。 */
  correctIndex?: number;
  /** 正确答案文本（选择题为选项文本，拼写题为英文词形）。 */
  correctAnswer: string;
  cardId: string;
  reviewLogId: string;
  /** 提交后展示给用户的单词详情（词形、词性、释义、例句等）。 */
  explanation: QuestionExplanation;
  /** 自动评分结果（Issue #7 验收标准 5）。 */
  rating?: ReviewRating;
  /** 更新后的下次复习时间戳（ms）。 */
  nextReviewAt?: number;
}

/**
 * 用户纠正评分的结果（Issue #7 验收标准 5）。
 * 纠正不是一次新的提交，因此不返回 correctIndex/explanation 等提交期字段。
 */
export interface CorrectionResult {
  cardId: string;
  reviewLogId: string;
  /** 纠正后的最终评分。 */
  rating: ReviewRating;
  /** 纠正后重新调度得到的下次复习时间戳（ms）。 */
  nextReviewAt?: number;
}

/**
 * 覆盖层发出的用户动作（Issue #6 / #7 / #8）。
 * 控制器据此调用 LearningService 并决定冷却结果。
 *
 * 软动作（不关闭遮罩）：
 * - `submit-answer`：提交选择题答案，进入反馈阶段；
 * - `submit-spelling`：提交拼写题答案，进入反馈阶段（Issue #8）；
 * - `correct-rating`：用户纠正评分，保持在反馈阶段。
 *
 * 连续学习动作（Issue #8 验收标准 1）：
 * - `submit-and-continue`：提交选择题并加载下一题，保留暂停状态；
 * - `submit-spelling-and-continue`：提交拼写题并加载下一题；
 * - `accept-new-word-and-continue`：接受新词并加载下一题；
 * - `self-report-and-continue`：自报认识并加载下一题。
 *
 * 终态动作（关闭遮罩、恢复视频、记录冷却）：
 * - `accept-new-word` / `self-report`：单题模式接受/自报；
 * - `skip`：跳过（未提交为真跳过，已提交为完成）；
 * - `exit-learning`：结束连续学习，不提交当前题，不算跳过，应用默认冷却（Issue #8 验收标准 4）。
 */
export type OverlayAction =
  | { type: 'accept-new-word'; wordId: string }
  | { type: 'self-report'; wordId: string }
  | {
      type: 'submit-answer';
      question: MultipleChoiceQuestion;
      selectedIndex: number;
      responseTimeMs: number;
      answerChanges?: number;
    }
  | {
      type: 'submit-spelling';
      question: SpellingQuestion;
      spelledAnswer: string;
      responseTimeMs: number;
      answerChanges?: number;
    }
  | { type: 'correct-rating'; reviewLogId: string; correction: UserCorrection }
  | { type: 'skip' }
  | {
      type: 'submit-and-continue';
      question: MultipleChoiceQuestion;
      selectedIndex: number;
      responseTimeMs: number;
      answerChanges?: number;
    }
  | {
      type: 'submit-spelling-and-continue';
      question: SpellingQuestion;
      spelledAnswer: string;
      responseTimeMs: number;
      answerChanges?: number;
    }
  | { type: 'accept-new-word-and-continue'; wordId: string }
  | { type: 'self-report-and-continue'; wordId: string }
  | { type: 'exit-learning' };
