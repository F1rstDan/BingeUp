import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';
import { SCROLL_TRIGGER_THRESHOLD_PX } from '../generic-video/detection';

export interface BasicWebAdapterOptions {
  /** 页面加载触发开关（AC3）。 */
  pageLoadTrigger: boolean;
  /** 明显滚动触发开关（AC3）。 */
  scrollTrigger: boolean;
}

/**
 * 基础网页适配器（Issue #11 AC3）。
 *
 * 用于无可靠视频的网页（CONTEXT.md：基础网页模式——无法可靠识别或控制主视频，
 * 使用页面加载或明显滚动作为自然触发点，并以全网页遮罩展示学习界面）。
 *
 * 支持两种触发方式（可独立开关）：
 * - 页面加载触发：页面加载后触发一次（冷却结束后生效）；
 * - 明显滚动触发：累计滚动超过阈值后触发一次，可多次触发。
 *
 * 事件中 video 为 null，遮罩使用全网页模式。
 */
export class BasicWebAdapter implements VideoSiteAdapter {
  readonly id = 'basic-web';

  constructor(private readonly options: BasicWebAdapterOptions) {}

  matches(location: Location): boolean {
    return location.protocol === 'https:' || location.protocol === 'http:';
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return null;
  }

  getVideoIdentity(_video: HTMLVideoElement): string | null {
    return null;
  }

  getOverlayTarget(_video: HTMLVideoElement): HTMLElement | DOMRect | null {
    return null;
  }

  getOverlayMode(): OverlayMode {
    return 'full-page';
  }

  isAdvertisement(_video: HTMLVideoElement): boolean {
    return false;
  }

  isPreview(_video: HTMLVideoElement): boolean {
    return false;
  }

  isLivePage(): boolean {
    return false;
  }

  observePageChanges(onVideoChanged: (event: VideoChangeEvent) => void): () => void {
    let stopped = false;
    let scrollAccumulated = 0;
    let scrollTriggerCount = 0;
    let lastScrollY = window.scrollY;
    const cleanups: (() => void)[] = [];

    // ─── 页面加载触发（AC3） ───────────────────────────────
    if (this.options.pageLoadTrigger) {
      const emitLoad = () => {
        if (stopped) return;
        onVideoChanged({
          identity: `basic-web:load:${location.href}`,
          video: null,
          overlayTarget: null,
          overlayMode: 'full-page',
        });
      };
      if (document.readyState === 'loading') {
        const handler = () => emitLoad();
        document.addEventListener('DOMContentLoaded', handler, { once: true });
        cleanups.push(() => document.removeEventListener('DOMContentLoaded', handler));
      } else {
        // DOM 已就绪：同步触发。控制器会异步处理冷却判定。
        emitLoad();
      }
    }

    // ─── 明显滚动触发（AC3） ───────────────────────────────
    if (this.options.scrollTrigger) {
      const onScroll = () => {
        if (stopped) return;
        const delta = Math.abs(window.scrollY - lastScrollY);
        lastScrollY = window.scrollY;
        scrollAccumulated += delta;
        if (scrollAccumulated >= SCROLL_TRIGGER_THRESHOLD_PX) {
          scrollAccumulated = 0;
          scrollTriggerCount += 1;
          onVideoChanged({
            identity: `basic-web:scroll:${location.href}:${scrollTriggerCount}`,
            video: null,
            overlayTarget: null,
            overlayMode: 'full-page',
          });
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', onScroll));
    }

    return () => {
      stopped = true;
      cleanups.forEach((fn) => fn());
    };
  }
}
