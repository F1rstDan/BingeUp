import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';

/** 视频被视为"有意义主播放器"的最小可见尺寸（px）。 */
const MIN_VIDEO_WIDTH = 200;
const MIN_VIDEO_HEIGHT = 120;

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

/** 判断元素是否在视口内且可见面积足够。 */
function isVisibleAndMeaningful(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) {
    return false;
  }
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }
  return true;
}

/**
 * 判断是否为背景视频（页面装饰性视频，非主播放器）。
 * 背景视频通常静音且循环播放，用于横幅或页面氛围而非用户主要观看内容。
 */
function isBackgroundVideo(video: HTMLVideoElement): boolean {
  return video.muted && video.loop;
}

/**
 * YouTube 专属适配器（Issue #4）。
 * 覆盖普通视频、Shorts、SPA 路由切换与直播的身份识别与触发控制；
 * 过滤广告、缩略图预览、背景视频与小窗非主播放器。
 */
export class YouTubeAdapter implements VideoSiteAdapter {
  readonly id = 'youtube';

  matches(location: Location): boolean {
    // Beta 仅支持 YouTube 普通视频与 Shorts（见 #1 规格）。YouTube Music 是独立产品，
    // 其 watch 页会产生视频身份，故显式排除，避免在 music.youtube.com 误触发。
    if (location.hostname === 'music.youtube.com') {
      return false;
    }
    return location.hostname.endsWith('youtube.com');
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    // YouTube 主播放器的 <video> 通常在 #movie_player / #shorts-player 内。
    const candidates = document.querySelectorAll<HTMLVideoElement>('video');
    let primary: HTMLVideoElement | null = null;
    let bestArea = 0;
    for (const video of candidates) {
      if (!isVisibleAndMeaningful(video)) {
        continue;
      }
      if (isBackgroundVideo(video)) {
        continue;
      }
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        primary = video;
      }
    }
    return primary;
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
    return !!player.querySelector('.ytp-ad-player-overlay, .ytp-ad-skip-indicator, .ytp-ad-skip-button');
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

    // 首次检测：页面刷新后立即尝试，并在 DOM 就绪后重试。
    detect();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', detect, { once: true });
    }

    // 播放器 DOM 异步加载（刷新后 video 元素可能在 document_idle 之后才出现）。
    // 去重由 identity 保证。
    const observer = new MutationObserver(() => detect());
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA 路由切换：YouTube 是 SPA，pushState/replaceState 不触发 popstate，必须包装原方法
    // 才能可靠捕获 URL 变化（即便视频元素复用、无 DOM 变更）。
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args);
      detect();
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState(...args);
      detect();
    };
    const onPopState = () => detect();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('yt-navigate-finish', onPopState);
    window.addEventListener('hashchange', onPopState);

    return () => {
      stopped = true;
      observer.disconnect();
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('yt-navigate-finish', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }
}
