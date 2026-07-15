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

/**
 * 为视频适配器增加“同一长视频按设置间隔产生额外自然触发点”的能力。
 * 设置在每次计时检查时读取，因此保存后无需重启内容脚本。
 */
export class TimedLearningAdapter implements VideoSiteAdapter {
  readonly id: string;

  constructor(
    private readonly delegate: VideoSiteAdapter,
    private readonly deps: {
      settings: { get(): Promise<TimedLearningSettings> };
      clock?: { now(): number };
      timers?: TimerPort;
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
    let stopped = false;
    let currentIdentity: string | null = null;
    let lastTriggerAt = clock.now();
    let checkInProgress = false;

    const stopDelegate = this.delegate.observePageChanges((event) => {
      currentIdentity = event.identity;
      lastTriggerAt = clock.now();
      onVideoChanged(event);
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

    const timerId = timers.setInterval(() => void check(), this.deps.pollMilliseconds ?? 1_000);
    return () => {
      stopped = true;
      timers.clearInterval(timerId);
      stopDelegate();
    };
  }
}
