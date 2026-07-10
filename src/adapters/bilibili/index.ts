import type { OverlayMode, VideoChangeEvent } from '@/types';
import type { VideoSiteAdapter } from '@/adapters/types';

/** 视频被视为"有意义主播放器"的最小可见尺寸（px）。 */
const MIN_VIDEO_WIDTH = 200;
const MIN_VIDEO_HEIGHT = 120;

/**
 * 从 Bilibili URL 中提取视频身份（BV 号或 live room id）。
 * 身份变化才视为新视频；播放器 DOM 变化不触发。
 */
export function getBilibiliVideoIdentity(href: string = location.href): string | null {
  // 普通视频：/video/BVxxxxxx
  const videoMatch = href.match(/\/video\/(BV[\w]+)/i);
  if (videoMatch?.[1]) {
    return videoMatch[1].toUpperCase();
  }
  // 竖屏/播放页：/v/[BV]
  const shortMatch = href.match(/\/v\/(BV[\w]+)/i);
  if (shortMatch?.[1]) {
    return shortMatch[1].toUpperCase();
  }
  // 直播：/live/12345 或 live.bilibili.com/12345
  const liveMatch = href.match(/(?:\/live\/|live\.bilibili\.com\/)(\d+)/i);
  if (liveMatch?.[1]) {
    return `live-${liveMatch[1]}`;
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
 * Bilibili 专属适配器（Issue #3）。
 * 覆盖普通视频、竖屏视频、站内 SPA 切换、直播的身份识别与触发控制；
 * 过滤广告、预览、缩略图、背景视频与非主播放器。
 */
export class BilibiliAdapter implements VideoSiteAdapter {
  readonly id = 'bilibili';

  matches(location: Location): boolean {
    return location.hostname.endsWith('bilibili.com');
  }

  findPrimaryVideo(): HTMLVideoElement | null {
    // Bilibili 主播放器的 <video> 通常在 .bpx-player-video-wrap 内。
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
    return getBilibiliVideoIdentity();
  }

  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null {
    // 优先用播放器容器，便于跟随布局变化；回退到视频本身矩形。
    const playerWrap = video.closest('.bpx-player-container, .bpx-player-video-wrap, #bilibili-player');
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

    // 首次检测：页面刷新后立即尝试，并在 DOM 就绪后重试。
    detect();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', detect, { once: true });
    }

    // 播放器 DOM 异步加载（刷新后 video 元素可能在 document_idle 之后才出现）。
    // 去重由 identity 保证。
    const observer = new MutationObserver(() => detect());
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA 路由切换：pushState/replaceState 不触发 popstate，必须包装原方法
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
    window.addEventListener('hashchange', onPopState);

    return () => {
      stopped = true;
      observer.disconnect();
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }
}
