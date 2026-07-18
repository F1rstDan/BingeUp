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
import type { StartLearningResponse } from '@/messaging/messages';
import type { DevCardType, PrepareDevCardResult, DevShowCardResult } from '@/dev-tools/messages';

/** 站点适配器端口：内容控制器只通过它接收视频变化事件。 */
export interface SiteAdapterPort {
  onVideoChange(handler: (event: VideoChangeEvent) => void): () => void;
  /**
   * 获取当前学习上下文（Issue #16）。视频模式返回主视频上下文；
   * 基础网页模式返回 video=null 的全网页上下文。
   */
  getCurrentLearningContext?(): VideoChangeEvent | null;
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
  onAction(handler: (action: OverlayAction) => unknown | Promise<unknown>): void;
  close(): void;
}

/** 学习服务端口：控制器通过它获取学习项目并处理用户动作。 */
export interface LearningServicePort {
  getNextItem(options?: {
    excludedWordIds?: Set<string>;
    allowSpelling?: boolean;
    allowEarlyShortTermReview?: boolean;
  }): Promise<LearningItem | null>;
  acceptNewWord(wordId: string): Promise<void>;
  selfReportKnown(wordId: string): Promise<void>;
  submitAnswer(submission: AnswerSubmission): Promise<SubmissionResult>;
  /** 提交拼写题答案（Issue #8 验收标准 3）。 */
  submitSpellingAnswer(submission: SpellingSubmission): Promise<SubmissionResult>;
  /** 用户在反馈阶段纠正评分（Issue #7）。 */
  correctRating(reviewLogId: string, correction: UserCorrection): Promise<unknown>;
  /** 开发题卡准备；开发构建之外的适配器可以不提供此能力。 */
  prepareDevCard?(cardType: DevCardType): Promise<PrepareDevCardResult>;
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

/** 全局暂停状态端口；主动学习不得绕过用户的总暂停。 */
export interface PauseStatePort {
  isGloballyPaused(): Promise<boolean>;
}

/** 站点首次触发状态端口。 */
export interface SiteStatePort {
  isEnabled(): Promise<boolean>;
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
  pauseState: PauseStatePort;
  clock: Clock;
  /** 从视频元素构造播放控制端口。 */
  videoPortFor: (video: HTMLVideoElement) => VideoPlaybackPort;
  siteState: SiteStatePort;
  /** 学习服务：获取学习项目并处理用户动作（Issue #6）。 */
  learningService: LearningServicePort;
  /** 学习会话日志（Issue #12）。可选：未提供时不记录会话日志。 */
  sessionLogger?: SessionLoggerPort;
  /** 自动恢复播放失败后的限频、非模态用户提示。 */
  playbackRecoveryNotice?: { show(): Promise<void> };
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
  continuousQuestionsAnswered: number;
  currentSource: 'natural' | 'manual' | 'continuous';
  source: 'natural' | 'manual';
  initialItemKind: LearningItem['kind'];
  initialOutcome?: SessionLogRecord['initialOutcome'];
  /** 是否由 Popup 主动学习入口启动，可在新词额度用完后使用主动巩固题。 */
  allowEarlyShortTermReview: boolean;
  /** 正式交互或开发交互；开发交互不产生冷却、首次触发和会话副作用。 */
  effects: 'standard' | 'dev';
}

/** Reassert the pause invariant without replacing the original playback snapshot. */
function pauseIfPlaying(playback: VideoPlaybackPort | null): void {
  if (playback !== null && !playback.paused && !playback.ended) {
    playback.pause();
  }
}

/**
 * 内容侧学习会话控制器。协调：视频变化 → 触发判定 → 暂停 → 获取学习项目 →
 * 打开遮罩 → 用户动作 →（软动作反馈 / 连续加载下一题 / 终态关闭）→ 恢复视频 → 更新冷却。
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
  private lastObservedIdentity: string | null = null;
  private active: ActiveInteraction | null = null;
  private pendingVideoChange: VideoChangeEvent | null = null;
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
      void this.handleVideoChange(event).catch((error) => {
        this.triggerInProgress = false;
        void this.recoverFromFailure(error);
      });
    });
    this.deps.overlay.onAction((action) =>
      this.handleAction(action).catch(async (error) => {
        await this.recoverFromFailure(error);
        return undefined;
      }),
    );
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
   * 返回可判别结果，供插件面板只在真正打开学习界面后关闭，并显示具体失败原因。
   */
  async startContinuousLearning(): Promise<StartLearningResponse> {
    // 已有交互或另一次触发仍在异步准备：避免并发覆盖学习会话。
    if (this.active !== null || this.triggerInProgress) {
      return { ok: false, reason: 'interaction-active' };
    }
    this.triggerInProgress = true;

    try {
      try {
        if (await this.deps.pauseState.isGloballyPaused()) {
          return { ok: false, reason: 'globally-paused' };
        }
        if (!(await this.deps.siteState.isEnabled())) {
          return { ok: false, reason: 'context-unavailable' };
        }
      } catch (error) {
        console.error('[BingeUp] 读取全局暂停状态失败', error);
        return { ok: false, reason: 'failed' };
      }

      const event = this.deps.adapter.getCurrentLearningContext?.() ?? null;
      if (event === null) {
        return { ok: false, reason: 'context-unavailable' };
      }
      // 连续模式允许拼写题（受 spellingEnabled 设置控制，Issue #10 AC1）；
      // 不传 excludedWordIds（会话刚开始，无已展示单词）。视频先暂停，避免异步取题期间继续播放。
      const playback = event.video === null ? null : this.deps.videoPortFor(event.video);
      const snapshot = playback === null ? null : pauseForInteraction(playback);
      let item: LearningItem | null;
      try {
        item = await this.deps.learningService.getNextItem({
          allowSpelling: true,
          allowEarlyShortTermReview: true,
        });
      } catch (error) {
        console.error('[BingeUp] 获取连续学习项目失败，恢复视频', error);
        if (playback !== null && snapshot !== null) await this.restorePlayback(playback, snapshot);
        return { ok: false, reason: 'failed' };
      }
      if (item === null) {
        if (playback !== null && snapshot !== null) await this.restorePlayback(playback, snapshot);
        return { ok: false, reason: 'no-learning-content' };
      }
      const target =
        event.overlayTarget ??
        (event.video === null ? document.documentElement : event.video.getBoundingClientRect());
      try {
        pauseIfPlaying(playback);
        this.deps.overlay.open(item, target, event.overlayMode, { isContinuous: true });
      } catch (error) {
        console.error('[BingeUp] 主动连续学习打开遮罩失败，恢复视频', error);
        if (playback !== null && snapshot !== null) await this.restorePlayback(playback, snapshot);
        return { ok: false, reason: 'failed' };
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
        continuousQuestionsAnswered: 0,
        currentSource: 'manual',
        source: 'manual',
        initialItemKind: item.kind,
        allowEarlyShortTermReview: true,
        effects: 'standard',
      };
      this.lastObservedIdentity = event.identity;
      this.hasSubmitted = false;
      this.trackWordId(item);
      return { ok: true };
    } finally {
      this.triggerInProgress = false;
    }
  }

  private async handleVideoChange(event: VideoChangeEvent, replayPending = false): Promise<void> {
    // 内容身份只做连续去重。先记录观察结果，确保 A→B→A 即使 B 因冷却或
    // 当前交互未触发，返回 A 仍属于新的自然触发点。
    if (!replayPending) {
      if (event.identity === this.lastObservedIdentity) return;
      this.lastObservedIdentity = event.identity;
    }
    // 正在交互中或并发触发：忽略。triggerInProgress 同步保证一次只处理一个触发，
    // 避免并发事件在 await 之间双双重入。
    // 注意：基础网页模式（Issue #11）允许 event.video === null，不在此处拦截。
    if (this.active !== null || this.triggerInProgress) {
      this.pendingVideoChange = event;
      return;
    }
    this.triggerInProgress = true;

    if (!(await this.deps.siteState.isEnabled())) {
      this.triggerInProgress = false;
      return;
    }

    const firstPending = await this.deps.siteState.isFirstQuestionPending();
    if (!firstPending) {
      const cooldown = await this.deps.cooldownStore.get();
      if (!isReady(cooldown, this.deps.clock.now())) {
        this.triggerInProgress = false;
        return;
      }
    }

    // 视频模式：先暂停视频，再获取学习项目。基础网页模式（video === null）：跳过暂停。
    const hasVideo = event.video !== null;
    const playback = hasVideo ? this.deps.videoPortFor(event.video!) : null;
    const snapshot = playback !== null ? pauseForInteraction(playback) : null;

    // 获取学习项目；无内容则不触发。单题模式不出拼写题。
    let item: LearningItem | null;
    try {
      item = await this.deps.learningService.getNextItem();
    } catch (error) {
      if (playback !== null && snapshot !== null) {
        await this.restorePlayback(playback, snapshot);
      }
      throw error;
    }
    if (item === null) {
      if (playback !== null && snapshot !== null) {
        await this.restorePlayback(playback, snapshot);
      }
      this.triggerInProgress = false;
      return;
    }

    // 遮罩目标：有视频时用视频区域；基础网页模式用文档根元素（全网页遮罩）。
    const target =
      event.overlayTarget ??
      (event.video !== null ? event.video.getBoundingClientRect() : document.documentElement);

    try {
      pauseIfPlaying(playback);
      this.deps.overlay.open(item, target, event.overlayMode);
    } catch (error) {
      console.error('[BingeUp] 打开遮罩失败，恢复视频', error);
      if (playback !== null && snapshot !== null) {
        await this.restorePlayback(playback, snapshot);
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
      continuousQuestionsAnswered: 0,
      currentSource: 'natural',
      source: 'natural',
      initialItemKind: item.kind,
      allowEarlyShortTermReview: false,
      effects: 'standard',
    };
    this.hasSubmitted = false;
    this.trackWordId(item);
    this.triggerInProgress = false;
  }

  /**
   * 开发题卡入口：只占用内容侧交互槽位，不检查暂停、站点或冷却，也不操作视频。
   * 题卡准备仍由 Background 的开发模块负责，提交动作继续复用正式学习服务。
   */
  async showDevCard(cardType: DevCardType): Promise<DevShowCardResult> {
    if (this.active !== null || this.triggerInProgress) {
      return { ok: false, reason: 'interaction-active' };
    }
    if (this.deps.learningService.prepareDevCard === undefined) {
      return { ok: false, reason: 'failed' };
    }

    this.triggerInProgress = true;
    try {
      const prepared = await this.deps.learningService.prepareDevCard(cardType);
      if (!prepared.ok) return prepared;

      const target = document.documentElement;
      this.deps.overlay.open(prepared.item, target, 'full-page', { isContinuous: false });
      this.active = {
        identity: `dev:${crypto.randomUUID()}`,
        playback: null,
        snapshot: null,
        target,
        overlayMode: 'full-page',
        startedAt: this.deps.clock.now(),
        mode: 'single',
        questionsAnswered: 0,
        continuousQuestionsAnswered: 0,
        currentSource: 'manual',
        source: 'manual',
        initialItemKind: prepared.item.kind,
        allowEarlyShortTermReview: false,
        effects: 'dev',
      };
      this.hasSubmitted = false;
      this.trackWordId(prepared.item);
      return { ok: true };
    } catch (error) {
      console.error('[BingeUp] 开发题卡打开失败', error);
      this.active = null;
      this.hasSubmitted = false;
      this.sessionWordIds.clear();
      try {
        this.deps.overlay.close();
      } catch (closeError) {
        console.error('[BingeUp] 开发题卡故障恢复时关闭遮罩失败', closeError);
      }
      return { ok: false, reason: 'failed' };
    } finally {
      this.triggerInProgress = false;
      if (this.active === null) await this.drainPendingVideoChange();
    }
  }

  private async handleAction(action: OverlayAction): Promise<unknown> {
    const active = this.active;
    // 没有进行中的交互：忽略，防止重复提交/恢复/冷却更新。
    if (active === null) {
      return;
    }

    if (action.type === 'recover') {
      await this.clearFailedInteraction(active);
      return;
    }

    // ─── 软动作：不关闭遮罩 ──────────────────────────────
    if (action.type === 'submit-answer') {
      const result = await this.deps.learningService.submitAnswer({
        question: action.question,
        selectedIndex: action.selectedIndex,
        responseTimeMs: action.responseTimeMs,
        answerChanges: action.answerChanges,
        source: active.currentSource,
      });
      this.hasSubmitted = true;
      this.recordSubmittedQuestion(active, result, action.question);
      return result;
    }

    if (action.type === 'submit-spelling') {
      const result = await this.deps.learningService.submitSpellingAnswer({
        question: action.question,
        spelledAnswer: action.spelledAnswer,
        responseTimeMs: action.responseTimeMs,
        answerChanges: action.answerChanges,
        source: active.currentSource,
      });
      this.hasSubmitted = true;
      this.recordSubmittedQuestion(active, result, action.question);
      return result;
    }

    if (action.type === 'correct-rating') {
      return this.deps.learningService.correctRating(action.reviewLogId, action.correction);
    }

    // ─── 连续学习动作：提交并加载下一题（Issue #8 验收标准 1） ───
    if (action.type === 'submit-and-continue') {
      if (!this.hasSubmitted) {
        const result = await this.deps.learningService.submitAnswer({
          question: action.question,
          selectedIndex: action.selectedIndex,
          responseTimeMs: action.responseTimeMs,
          answerChanges: action.answerChanges,
          source: active.currentSource,
        });
        this.recordSubmittedQuestion(active, result, action.question);
      }
      if (active.effects === 'dev') {
        await this.endInteraction(active, 'submitted');
        return;
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
          source: active.currentSource,
        });
        this.recordSubmittedQuestion(active, result, action.question);
      }
      if (active.effects === 'dev') {
        await this.endInteraction(active, 'submitted');
        return;
      }
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'submit-and-end') {
      if (!this.hasSubmitted) {
        const result = await this.deps.learningService.submitAnswer({
          question: action.question,
          selectedIndex: action.selectedIndex,
          responseTimeMs: action.responseTimeMs,
          answerChanges: action.answerChanges,
          source: active.currentSource,
        });
        this.hasSubmitted = true;
        this.recordSubmittedQuestion(active, result, action.question);
      }
      await this.endInteraction(active, 'submitted');
      return;
    }

    if (action.type === 'submit-spelling-and-end') {
      if (!this.hasSubmitted) {
        const result = await this.deps.learningService.submitSpellingAnswer({
          question: action.question,
          spelledAnswer: action.spelledAnswer,
          responseTimeMs: action.responseTimeMs,
          answerChanges: action.answerChanges,
          source: active.currentSource,
        });
        this.hasSubmitted = true;
        this.recordSubmittedQuestion(active, result, action.question);
      }
      await this.endInteraction(active, 'submitted');
      return;
    }

    if (action.type === 'accept-new-word-and-continue') {
      await this.deps.learningService.acceptNewWord(action.wordId);
      active.initialOutcome ??= 'accepted-new';
      this.lastFeedback = null;
      this.lastQuestion = null;
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'self-report-and-continue') {
      await this.deps.learningService.selfReportKnown(action.wordId);
      active.initialOutcome ??= 'self-reported';
      this.lastFeedback = null;
      this.lastQuestion = null;
      await this.loadNextContinuous(active);
      return;
    }

    if (action.type === 'self-report') {
      await this.deps.learningService.selfReportKnown(action.wordId);
      active.initialOutcome ??= 'self-reported';
      if (active.effects === 'dev') {
        await this.endInteraction(active, 'submitted');
        return;
      }
      this.lastFeedback = null;
      this.lastQuestion = null;
      pauseIfPlaying(active.playback);
      const nextItem = await this.deps.learningService.getNextItem({
        excludedWordIds: this.sessionWordIds,
      });
      if (nextItem === null) {
        await this.endInteraction(active, 'submitted');
        return;
      }
      this.trackWordId(nextItem);
      this.hasSubmitted = false;
      this.deps.overlay.open(nextItem, active.target, active.overlayMode, {
        previousFeedback: this.lastFeedback ?? undefined,
        previousQuestion: this.lastQuestion ?? undefined,
        isContinuous: false,
      });
      return;
    }

    // ─── 终态动作：关闭遮罩、恢复视频、记录冷却 ──────────────

    // exit-learning：结束连续学习，不提交当前题，不算跳过，应用默认冷却
    // （Issue #8 验收标准 4）。会话日志记为 'exit'（Issue #12）。
    if (action.type === 'exit-learning') {
      await this.endInteraction(active, 'submitted', 'exit');
      return;
    }

    // accept-new-word / skip：单题模式终态动作。
    let outcome: InteractionOutcome;
    switch (action.type) {
      case 'accept-new-word':
        await this.deps.learningService.acceptNewWord(action.wordId);
        active.initialOutcome ??= 'accepted-new';
        outcome = 'submitted';
        break;
      case 'skip':
        // 提交后点"继续"视为完成题目；未提交直接跳过才是真正的跳过。
        outcome = this.hasSubmitted ? 'submitted' : 'skipped';
        active.initialOutcome ??= this.hasSubmitted ? 'submitted' : 'skipped';
        break;
    }

    await this.endInteraction(active, outcome);
  }

  private recordSubmittedQuestion(
    active: ActiveInteraction,
    result: SubmissionResult,
    question: Question,
  ): void {
    active.questionsAnswered += 1;
    if (active.mode === 'continuous') active.continuousQuestionsAnswered += 1;
    active.initialOutcome ??= 'submitted';
    this.lastFeedback = result;
    this.lastQuestion = question;
  }

  /**
   * 加载下一道连续学习题目（Issue #8 验收标准 1）。
   * 视频保持暂停，遮罩更新为"上一题反馈 + 下一题"。
   * 若无更多内容，自动结束连续学习。
   */
  private async loadNextContinuous(active: ActiveInteraction): Promise<void> {
    pauseIfPlaying(active.playback);
    const nextItem = await this.deps.learningService.getNextItem({
      excludedWordIds: this.sessionWordIds,
      allowSpelling: true,
      allowEarlyShortTermReview: active.allowEarlyShortTermReview,
    });

    if (nextItem === null) {
      // 无更多学习内容：结束连续学习，应用默认冷却。
      await this.endInteraction(active, 'submitted');
      return;
    }

    // 进入连续学习模式（Issue #12：会话日志需正确记录 mode）。
    active.mode = 'continuous';
    active.currentSource = 'continuous';

    this.trackWordId(nextItem);
    this.hasSubmitted = false;

    pauseIfPlaying(active.playback);
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
    try {
      this.deps.overlay.close();
    } catch (error) {
      console.error('[BingeUp] 关闭遮罩失败', error);
    }
    if (active.playback !== null && active.snapshot !== null) {
      await this.restorePlayback(active.playback, active.snapshot);
    }
    if (active.effects === 'standard') {
      try {
        await this.deps.cooldownStore.recordOutcome(outcome);
        // 首次触发处理完后才进入全局冷却。
        await this.deps.siteState.markFirstQuestionHandled();
      } catch (error) {
        console.error('[BingeUp] 记录学习结果失败', error);
      }
      // 会话日志（Issue #12）：可选，未提供 sessionLogger 时跳过。
      // Issue #19 AC5：会话标识使用 crypto.randomUUID()，保证同一毫秒、同一内容身份的
      // 并发会话（多标签同时触发）仍各自唯一，不依赖 startedAt+identity 组合。
      if (this.deps.sessionLogger !== undefined) {
        try {
          await this.deps.sessionLogger.save({
            id: crypto.randomUUID(),
            startedAt: active.startedAt,
            endedAt: this.deps.clock.now(),
            mode: active.mode,
            outcome: sessionOutcome,
            questionsAnswered: active.questionsAnswered,
            continuousQuestionsAnswered: active.continuousQuestionsAnswered,
            source: active.source,
            initialItemKind: active.initialItemKind,
            initialOutcome: active.initialOutcome,
          });
        } catch (error) {
          console.error('[BingeUp] 会话日志写入失败', error);
        }
      }
    }
    await this.drainPendingVideoChange();
  }

  /** 任何学习/界面异常都优先解除遮罩并恢复用户原有播放状态。 */
  private async recoverFromFailure(error: unknown): Promise<void> {
    console.error('[BingeUp] 学习交互失败，正在返回视频', error);
    const active = this.active;
    this.triggerInProgress = false;
    if (active === null) return;

    await this.clearFailedInteraction(active);
  }

  /** 内部恢复不是用户跳过：只解除界面并恢复播放，不写冷却或会话结果。 */
  private async clearFailedInteraction(active: ActiveInteraction): Promise<void> {
    this.active = null;
    this.hasSubmitted = false;
    this.sessionWordIds.clear();
    this.lastFeedback = null;
    this.lastQuestion = null;
    try {
      this.deps.overlay.close();
    } catch (closeError) {
      console.error('[BingeUp] 故障恢复时关闭遮罩失败', closeError);
    }
    if (active.playback !== null && active.snapshot !== null) {
      await this.restorePlayback(active.playback, active.snapshot);
    }
    await this.drainPendingVideoChange();
  }

  private async drainPendingVideoChange(): Promise<void> {
    const pending = this.pendingVideoChange;
    if (pending === null || this.active !== null || this.triggerInProgress) return;
    this.pendingVideoChange = null;
    await this.handleVideoChange(pending, true);
  }

  private async restorePlayback(
    playback: VideoPlaybackPort,
    snapshot: PlaybackSnapshot,
  ): Promise<void> {
    const restored = await restore(playback, snapshot);
    if (restored) return;
    console.error('[BingeUp] 视频未能自动继续，请用户手动播放');
    try {
      await this.deps.playbackRecoveryNotice?.show();
    } catch (error) {
      console.error('[BingeUp] 显示播放恢复提示失败', error);
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
