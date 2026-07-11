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
   * - 长期复习词：由 FSRS 调度（后续 Issue）。undefined 表示暂不自动出题。
   */
  nextReviewAt?: number;
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

/** 新词展示：呈现候选新词的词形、释义和例句，不测试也不判分（CONTEXT.md：新词展示）。 */
export interface NewWordPresentation {
  word: WordRecord;
}

/**
 * 学习项目：一个自然触发点要呈现的内容（Issue #6，单题模式）。
 * - `new-word-presentation`：候选新词展示，不创建学习卡；
 * - `question`：针对已有学习卡的题目（含验证题）。
 */
export type LearningItem =
  | { kind: 'new-word-presentation'; presentation: NewWordPresentation }
  | { kind: 'question'; question: MultipleChoiceQuestion };

/** 提交答案的结果。 */
export interface AnswerSubmission {
  question: MultipleChoiceQuestion;
  selectedIndex: number;
  responseTimeMs: number;
}

/** 提交后的判定结果（含可展开的学习信息，Issue #6 验收标准 5）。 */
export interface SubmissionResult {
  isCorrect: boolean;
  correctIndex: number;
  cardId: string;
  reviewLogId: string;
  /** 提交后展示给用户的单词详情（词形、词性、释义、例句等）。 */
  explanation: QuestionExplanation;
}

/**
 * 覆盖层发出的用户动作（Issue #6）。
 * 控制器据此调用 LearningService 并决定冷却结果。
 * - `submit-answer` 是"软"动作：不关闭遮罩，进入反馈阶段；
 * - 其余为"终态"动作：关闭遮罩、恢复视频、记录冷却。
 */
export type OverlayAction =
  | { type: 'accept-new-word'; wordId: string }
  | { type: 'self-report'; wordId: string }
  | {
      type: 'submit-answer';
      question: MultipleChoiceQuestion;
      selectedIndex: number;
      responseTimeMs: number;
    }
  | { type: 'skip' };
