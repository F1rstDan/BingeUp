import type { VideoSiteAdapter } from '@/adapters/types';
import type { OverlayMode, VideoChangeEvent } from '@/types';

interface TimedLearningSettings {
  longVideoTimedLearningEnabled: boolean;
  longVideoIntervalMinutes: number;
}

interface TimerPort {
  setInterval(handler: () => void, milliseconds: number): number;
  clearInterval(id: number): void;
}

/** 页面可见性端口：便于在测试中注入。 */
export interface VisibilityPort {
  isHidden(): boolean;
  onChange(handler: () => void): () => void;
}

function createDefaultVisibility(): VisibilityPort {
  return {
    isHidden() {
      return document.visibilityState === 'hidden';
    },
    onChange(handler) {
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}

/**
 * 为视频适配器增加“同一长视频按设置间隔产生额外自然触发点”的能力。
 * 设置在每次计时检查时读取，因此保存后无需重启内容脚本。
 *
 * 定时触发仍只是候选自然触发点：广告/预览状态在此过滤，全局冷却、页面可见性、
 * 当前学习交互由内容控制器继续把关。页面隐藏时清理调度基准，避免恢复可见后立即弹题。
 */
export class TimedLearningAdapter implements VideoSiteAdapter {
  readonly id: string;

  constructor(
    private readonly delegate: VideoSiteAdapter,
    private readonly deps: {
      settings: { get(): Promise<TimedLearningSettings> };
      clock?: { now(): number };
      timers?: TimerPort;
      visibility?: VisibilityPort;
      pollMilliseconds?: number;
    },
  ) {
    this.id = delegate.id;
  }

  matches(location: Location): boolean {
    return this.delegate.matches(location);
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return this.delegate.findPrimaryVideo();
  }

  getVideoIdentity(video: HTMLVideoElement): string | null {
    return this.delegate.getVideoIdentity(video);
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    return this.delegate.getOverlayTarget(video);
  }

  getOverlayMode(): OverlayMode {
    return this.delegate.getOverlayMode();
  }

  isAdvertisement(video: HTMLVideoElement): boolean {
    return this.delegate.isAdvertisement(video);
  }

  isPreview(video: HTMLVideoElement): boolean {
    return this.delegate.isPreview(video);
  }

  isLivePage(): boolean {
    return this.delegate.isLivePage();
  }

  observePageChanges(onVideoChanged: (event: VideoChangeEvent) => void): () => void {
    const clock = this.deps.clock ?? { now: () => Date.now() };
    const timers =
      this.deps.timers ??
      ({
        setInterval: (handler, milliseconds) => window.setInterval(handler, milliseconds),
        clearInterval: (id) => window.clearInterval(id),
      } satisfies TimerPort);
    const visibility = this.deps.visibility ?? createDefaultVisibility();
    let stopped = false;
    let currentIdentity: string | null = null;
    let lastTriggerAt = clock.now();
    let checkInProgress = false;

    const stopDelegate = this.delegate.observePageChanges((event) => {
      currentIdentity = event.identity;
      lastTriggerAt = clock.now();
      onVideoChanged(event);
    });

    // 页面恢复可见时重置调度基准：隐藏期间不计入间隔，避免恢复可见后立即弹题。
    const stopVisibility = visibility.onChange(() => {
      if (!visibility.isHidden()) {
        lastTriggerAt = clock.now();
      }
    });

    const check = async () => {
      if (stopped || checkInProgress) return;
      checkInProgress = true;
      try {
        const settings = await this.deps.settings.get();
        const now = clock.now();
        if (!settings.longVideoTimedLearningEnabled) {
          lastTriggerAt = now;
          return;
        }
        // 页面不可见时不产生候选触发点（AC4：页面可见检查）。
        if (visibility.isHidden()) return;
        const video = this.delegate.findPrimaryVideo();
        if (!video || this.delegate.isAdvertisement(video) || this.delegate.isPreview(video))
          return;
        const identity = this.delegate.getVideoIdentity(video);
        if (!identity) return;
        if (identity !== currentIdentity) {
          currentIdentity = identity;
          lastTriggerAt = now;
          return;
        }
        const intervalMs = settings.longVideoIntervalMinutes * 60_000;
        const isLongEnough = this.delegate.isLivePage() || video.duration * 1000 >= intervalMs;
        if (!isLongEnough || now - lastTriggerAt < intervalMs) return;
        lastTriggerAt = now;
        onVideoChanged({
          identity: `timed:${identity}:${now}`,
          video,
          overlayTarget: this.delegate.getOverlayTarget(video),
          overlayMode: this.delegate.getOverlayMode(),
        });
      } finally {
        checkInProgress = false;
      }
    };

    const timerId = timers.setInterval(() => {
      void check().catch((error: unknown) => {
        console.error('[BingeUp] 检查长视频定时学习失败', error);
      });
    }, this.deps.pollMilliseconds ?? 1_000);
    return () => {
      stopped = true;
      timers.clearInterval(timerId);
      stopVisibility();
      stopDelegate();
    };
  }
}
