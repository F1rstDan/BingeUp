import type {
  AnswerSubmission,
  CooldownState,
  InteractionOutcome,
  LearningItem,
  OverlayAction,
  OverlayMode,
  PlaybackSnapshot,
  Question,
  SessionLogRecord,
  SpellingSubmission,
  SubmissionResult,
  UserCorrection,
  VideoChangeEvent,
} from '@/types';
import { isReady } from '@/cooldown/cooldown-rules';
import { pauseForInteraction, restore, type VideoPlaybackPort } from '@/video/playback-controller';

/** 站点适配器端口：内容控制器只通过它接收视频变化事件。 */
export interface SiteAdapterPort {
  onVideoChange(handler: (event: VideoChangeEvent) => void): () => void;
  /**
   * 获取当前主视频事件（Issue #9 AC4）。用于 Popup 主动触发连续学习；
   * 无当前视频时返回 null。基础网页模式可不实现。
   */
  getCurrentVideoEvent?(): VideoChangeEvent | null;
}

/**
 * 学习遮罩端口：控制器通过它打开/关闭界面并接收用户动作（Issue #6 / #8）。
 * open 需要传入 LearningItem；submit-answer 不关闭遮罩，其余动作关闭。
 * 连续学习模式下通过 options 传入上一题反馈（Issue #8 验收标准 2）。
 */
export interface OverlayOpenOptions {
  /** 连续学习模式：上一题的提交反馈，在下一题上方展示。 */
  previousFeedback?: SubmissionResult;
  /** 上一题的题目（用于反馈区展示题干与正确答案）。 */
  previousQuestion?: Question;
  /** 是否处于连续学习模式。 */
  isContinuous?: boolean;
}

export interface OverlayPort {
  open(
    item: LearningItem,
    target: HTMLElement | DOMRect,
    mode: OverlayMode,
    options?: OverlayOpenOptions,
  ): void;
  onAction(handler: (action: OverlayAction) => void): void;
  close(): void;
}

/** 学习服务端口：控制器通过它获取学习项目并处理用户动作。 */
export interface LearningServicePort {
  getNextItem(options?: { excludedWordIds?: Set<string>; allowSpelling?: boolean }): Promise<LearningItem | null>;
  acceptNewWord(wordId: string): Promise<void>;
  selfReportKnown(wordId: string): Promise<void>;
  submitAnswer(submission: AnswerSubmission): Promise<SubmissionResult>;
  /** 提交拼写题答案（Issue #8 验收标准 3）。 */
  submitSpellingAnswer(submission: SpellingSubmission): Promise<SubmissionResult>;
  /** 用户在反馈阶段纠正评分（Issue #7）。 */
  correctRating(reviewLogId: string, correction: UserCorrection): Promise<unknown>;
}

/**
 * 全局冷却存储端口。
 * 冷却规则由实现持有：内存实现用纯函数计算，background 实现转发到 service worker。
 * 控制器只读状态与记录结果，不关心计算细节。
 */
export interface CooldownStore {
  get(): Promise<CooldownState>;
  recordOutcome(outcome: InteractionOutcome): Promise<void>;
}

/** 站点首次触发状态端口。 */
export interface SiteStatePort {
  isFirstQuestionPending(): Promise<boolean>;
  markFirstQuestionHandled(): Promise<void>;
}

/**
 * 学习会话日志端口（Issue #12）。
 * 控制器在结束交互时写入会话日志，用于统计跳过、连续学习会话数和连续题数。
 */
export interface SessionLoggerPort {
  save(log: SessionLogRecord): Promise<void>;
}

/** 时钟端口，便于测试注入。 */
export interface Clock {
  now(): number;
}

export interface ContentControllerDeps {
  adapter: SiteAdapterPort;
  overlay: OverlayPort;
  cooldownStore: CooldownStore;
  clock: Clock;
  /** 从视频元素构造播放控制端口。 */
  videoPortFor: (video: HTMLVideoElement) => VideoPlaybackPort;
  siteState: SiteStatePort;
  /** 学习服务：获取学习项目并处理用户动作（Issue #6）。 */
  learningService: LearningServicePort;
  /** 学习会话日志（Issue #12）。可选：未提供时不记录会话日志。 */
  sessionLogger?: SessionLoggerPort;
  /** 拼写题开关（Issue #10 AC1）：仅连续学习模式出现拼写题。缺省 true。 */
  spellingEnabled?: boolean;
}

interface ActiveInteraction {
  identity: string;
  /**
   * 视频播放端口；基础网页模式（无视频）下为 null（Issue #11）。
   * null 时跳过暂停与恢复。
   */
  playback: VideoPlaybackPort | null;
  /** 播放快照；基础网页模式下为 null。 */
  snapshot: PlaybackSnapshot | null;
  /** 当前遮罩目标区域。 */
  target: HTMLElement | DOMRect;
  /** 当前遮罩模式。 */
  overlayMode: OverlayMode;
  /** 会话开始时间戳（Issue #12）。 */
  startedAt: number;
  /** 学习模式：单题 / 连续（Issue #12）。 */
  mode: 'single' | 'continuous';
  /** 会话中已提交的题目数（Issue #12）。 */
  questionsAnswered: number;
}

/**
 * 内容侧学习会话控制器。协调：视频变化 → 触发判定 → 获取学习项目 →
 * 暂停 → 打开遮罩 → 用户动作 →（软动作反馈 / 连续加载下一题 / 终态关闭）→ 恢复视频 → 更新冷却。
 *
 * 该控制器是核心编排边界，不包含网站选择器、FSRS、题目生成、冷却计算等细节。
 *
 * 连续学习模式（Issue #8）：
 * - 用户在反馈阶段选择"提交并继续"后进入连续模式，视频保持暂停；
 * - 连续模式中"结束学习"不提交当前题、不算跳过、应用默认冷却；
 * - 连续模式不会突破每日新词上限，且新词不会紧接着被重复测试。
 */
export class ContentController {
  private readonly deps: ContentControllerDeps;
  private readonly handledIdentities = new Set<string>();
  private active: ActiveInteraction | null = null;
  private triggerInProgress = false;
  private hasSubmitted = false;
  private unsubscribe: (() => void) | null = null;

  /** 连续学习中已展示过的单词 ID，避免重复展示（Issue #8 验收标准 5）。 */
  private readonly sessionWordIds = new Set<string>();
  /** 上一题的提交反馈，用于连续模式下一帧展示。 */
  private lastFeedback: SubmissionResult | null = null;
  /** 上一题的题目，用于连续模式下一帧展示。 */
  private lastQuestion: Question | null = null;

  constructor(deps: ContentControllerDeps) {
    this.deps = deps;
  }

  start(): void {
    this.unsubscribe = this.deps.adapter.onVideoChange((event) => {
      void this.handleVideoChange(event);
    });
    this.deps.overlay.onAction((action) => {
      void this.handleAction(action);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * 主动触发连续学习（Issue #9 AC4）。
   *
   * Popup 通过 START_CONTINUOUS_LEARNING 消息调用本方法。与视频变化触发的单题模式不同：
   * - 绕过冷却与首次触发判定，用户主动入口随时可用；
   * - 直接以连续模式打开遮罩（isContinuous: true），并请求允许拼写题；
   * - 视频暂停、恢复、冷却更新等终态行为与连续学习模式一致。
   *
   * 返回 false 的情况：已有进行中的交互、无当前主视频、无学习内容、遮罩打开失败。
   */
  async startContinuousLearning(): Promise<boolean> {
    // 已有进行中的交互：避免覆盖当前学习会话。
    if (this.active !== null) {
      return false;
    }
    const event = this.deps.adapter.getCurrentVideoEvent?.() ?? null;
    if (event === null || event.video === null) {
      return false;
    }
    // 连续模式允许拼写题（受 spellingEnabled 设置控制，Issue #10 AC1）；
    // 不传 excludedWordIds（会话刚开始，无已展示单词）。
    const allowSpelling = this.deps.spellingEnabled ?? true;
    const item = await this.deps.learningService.getNextItem({ allowSpelling });
    if (item === null) {
      return false;
    }
    const playback = this.deps.videoPortFor(event.video);
    const snapshot = pauseForInteraction(playback);
    const target = event.overlayTarget ?? event.video.getBoundingClientRect();
    try {
      this.deps.overlay.open(item, target, event.overlayMode, { isContinuous: true });
    } catch (error) {
      console.error('[BingeUp] 主动连续学习打开遮罩失败，恢复视频', error);
      await restore(playback, snapshot);
      return false;
    }
    this.active = {
      identity: event.identity,
      playback,
      snapshot,
      target,
      overlayMode: event.overlayMode,
      startedAt: this.deps.clock.now(),
      mode: 'continuous',
      questionsAnswered: 0,
    };
    this.handledIdentities.add(event.identity);
    this.hasSubmitted = false;
    this.trackWordId(item);
    return true;
  }

  private async handleVideoChange(event: VideoChangeEvent): Promise<void> {
    // 正在交互中或并发触发：忽略。triggerInProgress 同步保证一次只处理一个触发，
    // 避免并发事件在 await 之间双双重入。
    // 注意：基础网页模式（Issue #11）允许 event.video === null，不在此处拦截。
    if (this.active !== null || this.triggerInProgress) {
      return;
    }
    // 同一 identity 已经处理过：去重，避免 DOM 更新触发重复弹题。
    if (this.handledIdentities.has(event.identity)) {
      return;
    }
    this.triggerInProgress = true;

    const firstPending = await this.deps.siteState.isFirstQuestionPending();
    if (!firstPending) {
      const cooldown = await this.deps.cooldownStore.get();
      if (!isReady(cooldown, this.deps.clock.now())) {
        this.triggerInProgress = false;
        return;
      }
    }

    // 获取学习项目；无内容则不触发。单题模式不出拼写题。
    const item = await this.deps.learningService.getNextItem();
    if (item === null) {
      this.triggerInProgress = false;
      return;
    }

    // 视频模式：暂停视频。基础网页模式（video === null）：跳过暂停。
    const hasVideo = event.video !== null;
    const playback = hasVideo ? this.deps.videoPortFor(event.video!) : null;
    const snapshot = playback !== null ? pauseForInteraction(playback) : null;

    // 遮罩目标：有视频时用视频区域；基础网页模式用文档根元素（全网页遮罩）。
    const target = event.overlayTarget
      ?? (event.video !== null ? event.video.getBoundingClientRect() : document.documentElement);

    try {
      this.deps.overlay.open(item, target, event.overlayMode);
    } catch (error) {
      console.error('[BingeUp] 打开遮罩失败，恢复视频', error);
      if (playback !== null && snapshot !== null) {
        await restore(playback, snapshot);
      }
      this.triggerInProgress = false;
      return;
    }
    this.active = {
      identity: event.identity,
      playback,
      snapshot,
      target,
      overlayMode: event.overlayMode,
      startedAt: this.deps.clock.now(),
      mode: 'single',
      questionsAnswered: 0,
    };
    this.handledIdentities.add(event.identity);
    this.hasSubmitted = false;
    this.trackWordId(item);
    this.triggerInProgress = false;
  }

  private async handleAction(action: OverlayAction): Promise<void> {
    const active = this.active;
    // 没有进行中的交互：忽略，防止重复提交/恢复/冷却更新。
    if (active === null) {
      return;
    }

    // ─── 软动作：不关闭遮罩 ──────────────────────────────
    if (action.type === 'submit-answer') {
      const result = await this.deps.learningService.submitAnswer({
        question: action.question,
        selectedIndex: action.selectedIndex,
        responseTimeMs: action.responseTimeMs,
        answerChanges: action.answerChanges,
      });
      this.hasSubmitted = true;
      active.questionsAnswered += 1;
      this.lastFeedback = result;
      this.lastQuestion = action.question;
      return;
    }

    if (action.type === 'submit-spelling') {
      const result = await this.deps.learningService.submitSpellingAnswer({
        question: action.question,
        spelledAnswer: action.spelledAnswer,
        responseTimeMs: action.responseTimeMs,
        answerChanges: action.answerChanges,
      });
      this.hasSubmitted = true;
      active.questionsAnswered += 1;
      this.lastFeedback = result;
      this.lastQuestion = action.question;
      return;
    }

    if (action.type === 'correct-rating') {
      await this.deps.learningService.correctRating(action.reviewLogId, action.correction);
      return;
    }

    // ─── 连续学习动作：提交并加载下一题（Issue #8 验收标准 1） ───
    if (action.type === 'submit-and-continue') {
      if (!this.hasSubmitted) {
        const result = await this.deps.learningService.submitAnswer({
          question: action.question,
          selectedIndex: action.selectedIndex,
          responseTimeMs: action.responseTimeMs,
          answerChanges: action.answerChanges,
        });
        active.questionsAnswered += 1;
        this.lastFeedback = result;
        this.lastQuestion = action.question;
      }
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'submit-spelling-and-continue') {
      if (!this.hasSubmitted) {
        const result = await this.deps.learningService.submitSpellingAnswer({
          question: action.question,
          spelledAnswer: action.spelledAnswer,
          responseTimeMs: action.responseTimeMs,
          answerChanges: action.answerChanges,
        });
        active.questionsAnswered += 1;
        this.lastFeedback = result;
        this.lastQuestion = action.question;
      }
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'accept-new-word-and-continue') {
      await this.deps.learningService.acceptNewWord(action.wordId);
      this.lastFeedback = null;
      this.lastQuestion = null;
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'self-report-and-continue') {
      await this.deps.learningService.selfReportKnown(action.wordId);
      this.lastFeedback = null;
      this.lastQuestion = null;
      await this.loadNextContinuous(active);
      return;
    }

    // ─── 终态动作：关闭遮罩、恢复视频、记录冷却 ──────────────

    // exit-learning：结束连续学习，不提交当前题，不算跳过，应用默认冷却
    // （Issue #8 验收标准 4）。会话日志记为 'exit'（Issue #12）。
    if (action.type === 'exit-learning') {
      await this.endInteraction(active, 'submitted', 'exit');
      return;
    }

    // accept-new-word / self-report / skip：单题模式终态动作。
    let outcome: InteractionOutcome;
    switch (action.type) {
      case 'accept-new-word':
        await this.deps.learningService.acceptNewWord(action.wordId);
        outcome = 'submitted';
        break;
      case 'self-report':
        await this.deps.learningService.selfReportKnown(action.wordId);
        outcome = 'submitted';
        break;
      case 'skip':
        // 提交后点"继续"视为完成题目；未提交直接跳过才是真正的跳过。
        outcome = this.hasSubmitted ? 'submitted' : 'skipped';
        break;
    }

    await this.endInteraction(active, outcome);
  }

  /**
   * 加载下一道连续学习题目（Issue #8 验收标准 1）。
   * 视频保持暂停，遮罩更新为"上一题反馈 + 下一题"。
   * 若无更多内容，自动结束连续学习。
   */
  private async loadNextContinuous(active: ActiveInteraction): Promise<void> {
    const allowSpelling = this.deps.spellingEnabled ?? true;
    const nextItem = await this.deps.learningService.getNextItem({
      excludedWordIds: this.sessionWordIds,
      allowSpelling,
    });

    if (nextItem === null) {
      // 无更多学习内容：结束连续学习，应用默认冷却。
      await this.endInteraction(active, 'submitted');
      return;
    }

    // 进入连续学习模式（Issue #12：会话日志需正确记录 mode）。
    active.mode = 'continuous';

    this.trackWordId(nextItem);
    this.hasSubmitted = false;

    this.deps.overlay.open(nextItem, active.target, active.overlayMode, {
      previousFeedback: this.lastFeedback ?? undefined,
      previousQuestion: this.lastQuestion ?? undefined,
      isContinuous: true,
    });
  }

  /**
   * 结束当前交互：关闭遮罩、恢复视频、记录冷却、清理状态、写入会话日志。
   * 基础网页模式下 playback/snapshot 为 null，跳过恢复。
   *
   * @param outcome 冷却结果（'submitted' | 'skipped'），决定下次触发冷却时长。
   * @param sessionOutcome 会话日志结果（'submitted' | 'skipped' | 'exit'）；
   *   默认与 outcome 一致。exit-learning 传 'exit'：用户主动结束连续学习，
   *   不算提交也不算跳过，但仍应用默认冷却（outcome='submitted'）。
   */
  private async endInteraction(
    active: ActiveInteraction,
    outcome: InteractionOutcome,
    sessionOutcome: 'submitted' | 'skipped' | 'exit' = outcome,
  ): Promise<void> {
    this.active = null;
    this.hasSubmitted = false;
    this.sessionWordIds.clear();
    this.lastFeedback = null;
    this.lastQuestion = null;
    this.deps.overlay.close();
    if (active.playback !== null && active.snapshot !== null) {
      await restore(active.playback, active.snapshot);
    }
    await this.deps.cooldownStore.recordOutcome(outcome);
    // 首次触发处理完后才进入全局冷却。
    await this.deps.siteState.markFirstQuestionHandled();
    // 会话日志（Issue #12）：可选，未提供 sessionLogger 时跳过。
    if (this.deps.sessionLogger !== undefined) {
      try {
        await this.deps.sessionLogger.save({
          id: `session-${active.startedAt}-${active.identity}`,
          startedAt: active.startedAt,
          endedAt: this.deps.clock.now(),
          mode: active.mode,
          outcome: sessionOutcome,
          questionsAnswered: active.questionsAnswered,
        });
      } catch (error) {
        console.error('[BingeUp] 会话日志写入失败', error);
      }
    }
  }

  /** 追踪学习项目中涉及的单词 ID（用于连续模式排除重复）。 */
  private trackWordId(item: LearningItem): void {
    if (item.kind === 'new-word-presentation') {
      this.sessionWordIds.add(item.presentation.word.id);
    } else {
      this.sessionWordIds.add(item.question.wordId);
    }
  }
}
