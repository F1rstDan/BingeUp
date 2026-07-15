import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';
import { createPageObservationScheduler } from '@/adapters/observation';
import { isYouTubeHostname } from '@/sites/supported-sites';
import { MIN_VIDEO_HEIGHT, MIN_VIDEO_WIDTH, selectPrimaryVideo } from '@/adapters/video-candidates';

/**
 * 从 YouTube URL 中提取视频身份。
 * 身份包含表面（watch/shorts/live）：同一视频 ID 在 watch 与 Shorts 之间切换
 * 属于不同观看上下文，应视为新视频。身份变化才视为新视频；播放器 DOM 变化不触发。
 */
export function getYouTubeVideoIdentity(href: string = location.href): string | null {
  // 普通视频：/watch?v=VIDEO_ID（YouTube 标准 11 位，宽松匹配 6+ 以兼容异常 ID）
  const watchMatch = href.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watchMatch?.[1]) {
    return `yt:watch:${watchMatch[1]}`;
  }
  // Shorts：/shorts/VIDEO_ID
  const shortsMatch = href.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (shortsMatch?.[1]) {
    return `yt:shorts:${shortsMatch[1]}`;
  }
  // 直播：/live/VIDEO_ID
  const liveMatch = href.match(/\/live\/([A-Za-z0-9_-]{6,})/);
  if (liveMatch?.[1]) {
    return `yt:live:${liveMatch[1]}`;
  }
  return null;
}

/**
 * YouTube 专属适配器（Issue #4）。
 * 覆盖普通视频、Shorts、SPA 路由切换与直播的身份识别与触发控制；
 * 过滤广告、缩略图预览、背景视频与小窗非主播放器。
 */
export class YouTubeAdapter implements VideoSiteAdapter {
  readonly id = 'youtube';

  matches(location: Location): boolean {
    return isYouTubeHostname(location.hostname);
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    return selectPrimaryVideo(
      document.querySelectorAll<HTMLVideoElement>('video'),
      (video) => this.isAdvertisement(video) || this.isPreview(video),
    );
  }

  getVideoIdentity(_video: HTMLVideoElement): string | null {
    return getYouTubeVideoIdentity();
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    // 优先用播放器容器，便于跟随布局变化；回退到视频本身矩形。
    const playerWrap = video.closest('#movie_player, #shorts-player, ytd-player');
    if (playerWrap instanceof HTMLElement) {
      return playerWrap;
    }
    return video.getBoundingClientRect();
  }

  getOverlayMode(): OverlayMode {
    return 'video-region';
  }

  isAdvertisement(video: HTMLVideoElement): boolean {
    // YouTube 广告在主播放器内播放（同一 <video>），播放器获得 .ad-showing 类，
    // 或出现 .ytp-ad-player-overlay 等广告覆盖层。
    const player = video.closest('#movie_player, #shorts-player, ytd-player');
    if (!player) {
      return false;
    }
    if (player.classList.contains('ad-showing')) {
      return true;
    }
    return !!player.querySelector(
      '.ytp-ad-player-overlay, .ytp-ad-skip-indicator, .ytp-ad-skip-button',
    );
  }

  isPreview(video: HTMLVideoElement): boolean {
    // 悬停预览/缩略图视频通常尺寸较小或位于推荐/搜索结果卡片内。
    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) {
      return true;
    }
    return !!video.closest(
      'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-video-preview, [data-preview="true"]',
    );
  }

  isLivePage(): boolean {
    // href 包含 pathname，统一用 href 检测即可。
    return /\/live\//i.test(location.href);
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

    // SPA 路由切换：YouTube 是 SPA，pushState/replaceState 不触发 popstate，必须包装原方法
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
    window.addEventListener('yt-navigate-finish', onPopState);
    window.addEventListener('hashchange', onPopState);

    return () => {
      stopped = true;
      observer.disconnect();
      scheduler.dispose();
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('yt-navigate-finish', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }
}
