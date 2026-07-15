import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';

/**
 * Keeps a custom page usable as basic web while watching for a reliable video.
 * The upgrade is one-way for the page session to avoid compatibility-state flapping.
 */
export class AdaptiveCustomSiteAdapter implements VideoSiteAdapter {
  readonly id = 'adaptive-custom-site';
  readonly supportsBasicContext = true;
  readonly supportsTimedLearning = false;
  private upgraded = false;

  constructor(
    private readonly basic: VideoSiteAdapter,
    private readonly generic: VideoSiteAdapter,
    private readonly onUpgrade: () => Promise<void>,
  ) {}

  matches(location: Location): boolean {
    return this.generic.matches(location);
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return this.generic.findPrimaryVideo();
  }

  getVideoIdentity(video: HTMLVideoElement): string | null {
    return this.generic.getVideoIdentity(video);
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    return this.generic.getOverlayTarget(video);
  }

  getOverlayMode(): OverlayMode {
    return 'full-page';
  }

  isAdvertisement(video: HTMLVideoElement): boolean {
    return this.generic.isAdvertisement(video);
  }

  isPreview(video: HTMLVideoElement): boolean {
    return this.generic.isPreview(video);
  }

  isLivePage(): boolean {
    return false;
  }

  observePageChanges(onVideoChanged: (event: VideoChangeEvent) => void): () => void {
    const stopBasic = this.basic.observePageChanges((event) => {
      if (!this.upgraded) onVideoChanged(event);
    });
    const stopGeneric = this.generic.observePageChanges((event) => {
      if (!this.upgraded) {
        this.upgraded = true;
        void this.onUpgrade().catch((error: unknown) => {
          console.error('[BingeUp] 同步通用视频兼容等级失败', error);
        });
      }
      onVideoChanged({
        ...event,
        overlayTarget: document.documentElement,
        overlayMode: 'full-page',
      });
    });
    return () => {
      stopBasic();
      stopGeneric();
    };
  }
}
