import type {
  CooldownState,
  InteractionOutcome,
  OverlayMode,
  PlaybackSnapshot,
  VideoChangeEvent,
} from '@/types';
import { isReady } from '@/cooldown/cooldown-rules';
import { pauseForInteraction, restore, type VideoPlaybackPort } from '@/video/playback-controller';

/** 站点适配器端口：内容控制器只通过它接收视频变化事件。 */
export interface SiteAdapterPort {
  onVideoChange(handler: (event: VideoChangeEvent) => void): () => void;
}

/** 学习遮罩端口：控制器通过它打开/关闭界面并接收用户结果。 */
export interface OverlayPort {
  open(target: HTMLElement | DOMRect, mode: OverlayMode): void;
  onOutcome(handler: (outcome: InteractionOutcome) => void): void;
  close(): void;
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
}

interface ActiveInteraction {
  identity: string;
  playback: VideoPlaybackPort;
  snapshot: PlaybackSnapshot;
}

/**
 * 内容侧学习会话控制器。协调：视频变化 → 触发判定 → 暂停 → 打开遮罩 →
 * 用户结果 → 关闭遮罩 → 恢复视频 → 更新冷却。
 *
 * 该控制器是核心编排边界，不包含网站选择器、FSRS、题目生成、冷却计算等细节。
 */
export class ContentController {
  private readonly deps: ContentControllerDeps;
  private readonly handledIdentities = new Set<string>();
  private active: ActiveInteraction | null = null;
  private triggerInProgress = false;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: ContentControllerDeps) {
    this.deps = deps;
  }

  start(): void {
    this.unsubscribe = this.deps.adapter.onVideoChange((event) => {
      void this.handleVideoChange(event);
    });
    this.deps.overlay.onOutcome((outcome) => {
      void this.handleOutcome(outcome);
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

    // 允许触发：暂停视频并打开遮罩。若遮罩打开失败，恢复视频并清理，
    // 避免留下永久暂停的视频。
    const playback = this.deps.videoPortFor(event.video);
    const snapshot = pauseForInteraction(playback);
    try {
      this.deps.overlay.open(
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
    this.triggerInProgress = false;
  }

  private async handleOutcome(outcome: InteractionOutcome): Promise<void> {
    const active = this.active;
    // 没有进行中的交互：忽略，防止重复提交/恢复/冷却更新。
    if (active === null) {
      return;
    }
    this.active = null;

    this.deps.overlay.close();
    await restore(active.playback, active.snapshot);
    await this.deps.cooldownStore.recordOutcome(outcome);
    // 首次触发处理完后才进入全局冷却。
    await this.deps.siteState.markFirstQuestionHandled();
  }
}
