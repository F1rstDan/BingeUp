import type {
  AnswerSubmission,
  CooldownState,
  InteractionOutcome,
  LearningItem,
  OverlayAction,
  OverlayMode,
  PlaybackSnapshot,
  UserCorrection,
  VideoChangeEvent,
} from '@/types';
import { isReady } from '@/cooldown/cooldown-rules';
import { pauseForInteraction, restore, type VideoPlaybackPort } from '@/video/playback-controller';

/** 站点适配器端口：内容控制器只通过它接收视频变化事件。 */
export interface SiteAdapterPort {
  onVideoChange(handler: (event: VideoChangeEvent) => void): () => void;
}

/**
 * 学习遮罩端口：控制器通过它打开/关闭界面并接收用户动作（Issue #6）。
 * open 需要传入 LearningItem；submit-answer 不关闭遮罩，其余动作关闭。
 */
export interface OverlayPort {
  open(item: LearningItem, target: HTMLElement | DOMRect, mode: OverlayMode): void;
  onAction(handler: (action: OverlayAction) => void): void;
  close(): void;
}

/** 学习服务端口：控制器通过它获取学习项目并处理用户动作。 */
export interface LearningServicePort {
  getNextItem(): Promise<LearningItem | null>;
  acceptNewWord(wordId: string): Promise<void>;
  selfReportKnown(wordId: string): Promise<void>;
  submitAnswer(submission: AnswerSubmission): Promise<unknown>;
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
}

interface ActiveInteraction {
  identity: string;
  playback: VideoPlaybackPort;
  snapshot: PlaybackSnapshot;
}

/**
 * 内容侧学习会话控制器。协调：视频变化 → 触发判定 → 获取学习项目 →
 * 暂停 → 打开遮罩 → 用户动作 →（软动作反馈 / 终态关闭）→ 恢复视频 → 更新冷却。
 *
 * 该控制器是核心编排边界，不包含网站选择器、FSRS、题目生成、冷却计算等细节。
 */
export class ContentController {
  private readonly deps: ContentControllerDeps;
  private readonly handledIdentities = new Set<string>();
  private active: ActiveInteraction | null = null;
  private triggerInProgress = false;
  private hasSubmitted = false;
  private unsubscribe: (() => void) | null = null;

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

  private async handleVideoChange(event: VideoChangeEvent): Promise<void> {
    // 没有视频或正在交互中：忽略。triggerInProgress 同步保证一次只处理一个触发，
    // 避免并发事件在 await 之间双双重入。
    if (event.video === null || this.active !== null || this.triggerInProgress) {
      return;
    }
    // 同一视频 identity 已经处理过：去重，避免 DOM 更新触发重复弹题。
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

    // 获取学习项目；无内容则不触发。
    const item = await this.deps.learningService.getNextItem();
    if (item === null) {
      this.triggerInProgress = false;
      return;
    }

    // 允许触发：暂停视频并打开遮罩。若遮罩打开失败，恢复视频并清理，
    // 避免留下永久暂停的视频。
    const playback = this.deps.videoPortFor(event.video);
    const snapshot = pauseForInteraction(playback);
    try {
      this.deps.overlay.open(
        item,
        event.overlayTarget ?? event.video.getBoundingClientRect(),
        event.overlayMode,
      );
    } catch (error) {
      console.error('[BingeUp] 打开遮罩失败，恢复视频', error);
      await restore(playback, snapshot);
      this.triggerInProgress = false;
      return;
    }
    this.active = { identity: event.identity, playback, snapshot };
    this.handledIdentities.add(event.identity);
    this.hasSubmitted = false;
    this.triggerInProgress = false;
  }

  private async handleAction(action: OverlayAction): Promise<void> {
    const active = this.active;
    // 没有进行中的交互：忽略，防止重复提交/恢复/冷却更新。
    if (active === null) {
      return;
    }

    // submit-answer 是"软"动作：调用学习服务但不关闭遮罩。
    if (action.type === 'submit-answer') {
      await this.deps.learningService.submitAnswer({
        question: action.question,
        selectedIndex: action.selectedIndex,
        responseTimeMs: action.responseTimeMs,
        answerChanges: action.answerChanges,
      });
      this.hasSubmitted = true;
      return;
    }

    // correct-rating 也是"软"动作：用户在反馈阶段纠正评分，不关闭遮罩（Issue #7）。
    if (action.type === 'correct-rating') {
      await this.deps.learningService.correctRating(action.reviewLogId, action.correction);
      return;
    }

    // 终态动作：调用学习服务、关闭遮罩、恢复视频、记录冷却。
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

    this.active = null;
    this.hasSubmitted = false;
    this.deps.overlay.close();
    await restore(active.playback, active.snapshot);
    await this.deps.cooldownStore.recordOutcome(outcome);
    // 首次触发处理完后才进入全局冷却。
    await this.deps.siteState.markFirstQuestionHandled();
  }
}
