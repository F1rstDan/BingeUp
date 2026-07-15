import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';
import { createPageObservationScheduler } from '@/adapters/observation';
import { isBilibiliHostname } from '@/sites/supported-sites';
import { MIN_VIDEO_HEIGHT, MIN_VIDEO_WIDTH, selectPrimaryVideo } from '@/adapters/video-candidates';

/**
 * 从 Bilibili URL 中提取当前观看内容身份。
 * 身份变化才视为新视频；播放器 DOM 变化不触发。
 */
export function getBilibiliVideoIdentity(href: string = location.href): string | null {
  const url = new URL(href, location.origin);
  // 普通视频：/video/BVxxxxxx
  // 竖屏/播放页：/v/[BV]
  const videoMatch = url.pathname.match(/\/(?:video|v)\/(BV[\w]+)/i);
  if (videoMatch?.[1]) {
    const rawPart = url.searchParams.get('p');
    const parsedPart = rawPart === null ? 1 : Number.parseInt(rawPart, 10);
    const part = Number.isInteger(parsedPart) && parsedPart > 0 ? parsedPart : 1;
    return `bili:video:${videoMatch[1].toUpperCase()}:p${part}`;
  }
  // 番剧/影视：当前集 ep ID 是内容身份；ss ID 只代表整季，不猜测当前集。
  const episodeMatch = url.pathname.match(/\/bangumi\/play\/ep(\d+)/i);
  if (episodeMatch?.[1]) {
    return `bili:episode:${episodeMatch[1]}`;
  }
  // 直播：/live/12345 或 live.bilibili.com/12345
  const liveMatch =
    url.pathname.match(/\/live\/(\d+)/i) ??
    (url.hostname === 'live.bilibili.com' ? url.pathname.match(/^\/(\d+)/) : null);
  if (liveMatch?.[1]) {
    return `bili:live:${liveMatch[1]}`;
  }
  return null;
}

/**
 * Bilibili 专属适配器（Issue #3）。
 * 覆盖普通视频、竖屏视频、站内 SPA 切换、直播的身份识别与触发控制；
 * 过滤广告、预览、缩略图、背景视频与非主播放器。
 */
export class BilibiliAdapter implements VideoSiteAdapter {
  readonly id = 'bilibili';

  matches(location: Location): boolean {
    return isBilibiliHostname(location.hostname);
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return selectPrimaryVideo(
      document.querySelectorAll<HTMLVideoElement>('video'),
      (video) => this.isAdvertisement(video) || this.isPreview(video),
    );
  }

  getVideoIdentity(_video: HTMLVideoElement): string | null {
    return getBilibiliVideoIdentity();
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    // 优先用完整的播放器容器。不能把多个选择器放进一次 closest：
    // video-wrap 往往比 bpx-player-container 更近，但它可能只覆盖画面上半段。
    const playerContainer = video.closest('.bpx-player-container');
    if (playerContainer instanceof HTMLElement) {
      return playerContainer;
    }
    const playerRoot = video.closest('#bilibili-player');
    if (playerRoot instanceof HTMLElement) {
      return playerRoot;
    }
    const playerWrap = video.closest('.bpx-player-video-wrap');
    if (playerWrap instanceof HTMLElement) {
      return playerWrap;
    }
    return video.getBoundingClientRect();
  }

  getOverlayMode(): OverlayMode {
    return 'video-region';
  }

  isAdvertisement(video: HTMLVideoElement): boolean {
    // Bilibili 广告通常出现在 .bpx-player-ad-wrap 内或带 data-ad 属性。
    return !!video.closest('.bpx-player-ad-wrap, [data-ad="true"]');
  }

  isPreview(video: HTMLVideoElement): boolean {
    // 悬停预览/小窗视频通常尺寸较小或位于推荐卡片内。
    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) {
      return true;
    }
    return !!video.closest('.video-card, .rec-list, [data-preview="true"]');
  }

  isLivePage(): boolean {
    return /\/live\/|live\.bilibili\.com/i.test(location.href);
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

    // 播放器 DOM 异步加载（刷新后 video 元素可能在 document_idle 之后才出现）。
    // 去重由 identity 保证。
    const observer = new MutationObserver(() => scheduler.schedule());
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA 路由切换：pushState/replaceState 不触发 popstate，必须包装原方法
    // 才能可靠捕获 URL 变化（即便视频元素复用、无 DOM 变更）。
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
    const onPopState = () => scheduler.schedule();
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
