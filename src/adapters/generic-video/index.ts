import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';
import { createPageObservationScheduler } from '@/adapters/observation';
import {
  findPrimaryVideoGeneric,
  getGenericVideoIdentity,
  MIN_VIDEO_WIDTH,
  MIN_VIDEO_HEIGHT,
} from './detection';

/**
 * 通用视频适配器（Issue #11）。
 *
 * 用于用户主动加入的非官方视频网站。不依赖网站专属选择器，
 * 通过通用视频检测（尺寸/可见性/背景过滤/评分）查找主播放器。
 *
 * 遮罩使用全网页模式（CONTEXT.md：通用视频模式——能够找到并控制主视频，
 * 但无法稳定定位视频区域，因而使用全网页遮罩）。
 */
export class GenericVideoAdapter implements VideoSiteAdapter {
  readonly id = 'generic-video';

  matches(location: Location): boolean {
    // 匹配所有 HTTP/HTTPS 页面；由 bootstrap 在官方适配器未匹配时启用。
    return location.protocol === 'https:' || location.protocol === 'http:';
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return findPrimaryVideoGeneric();
  }

  getVideoIdentity(video: HTMLVideoElement): string | null {
    return getGenericVideoIdentity(video);
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    // 通用模式下不依赖网站专属容器，使用视频本身矩形。
    return video.getBoundingClientRect();
  }

  getOverlayMode(): OverlayMode {
    return 'full-page';
  }

  isAdvertisement(_video: HTMLVideoElement): boolean {
    // 通用模式无法识别广告，不过滤。
    return false;
  }

  isPreview(video: HTMLVideoElement): boolean {
    // 尺寸过小视为预览。
    const rect = video.getBoundingClientRect();
    return rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT;
  }

  isLivePage(): boolean {
    return false;
  }

  observePageChanges(onVideoChanged: (event: VideoChangeEvent) => void): () => void {
    let lastIdentity: string | null = null;
    let stopped = false;

    const detect = () => {
      if (stopped) return;
      const video = this.findPrimaryVideo();
      if (!video) return;
      if (this.isAdvertisement(video) || this.isPreview(video)) return;
      const identity = this.getVideoIdentity(video);
      if (!identity || identity === lastIdentity) return;
      lastIdentity = identity;

      onVideoChanged({
        identity,
        video,
        overlayTarget: this.getOverlayTarget(video),
        overlayMode: this.getOverlayMode(),
      });
    };
    const scheduler = createPageObservationScheduler(detect);

    // 首次检测：页面刷新后立即尝试，并在 DOM 就绪后重试。
    if (document.visibilityState !== 'hidden') detect();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduler.schedule, { once: true });
    }

    // 播放器 DOM 异步加载时通过 MutationObserver 检测。
    const observer = new MutationObserver(() => scheduler.schedule());
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA 路由切换：URL 变化时重置身份，允许重新检测。
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args);
      scheduler.schedule();
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState(...args);
      scheduler.schedule();
    };
    const onPopState = () => {
      scheduler.schedule();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);

    return () => {
      stopped = true;
      observer.disconnect();
      scheduler.dispose();
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }
}
