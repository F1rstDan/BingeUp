import type { SiteMode } from '@/types';

/** 视频被视为"有意义主播放器"的最小可见尺寸（px）。 */
export const MIN_VIDEO_WIDTH = 200;
export const MIN_VIDEO_HEIGHT = 120;

/** 明显滚动的累计阈值（px）；超过后触发一次基础网页模式学习（Issue #11 AC3）。 */
export const SCROLL_TRIGGER_THRESHOLD_PX = 2000;

/** 判断元素是否在视口内且可见面积足够。 */
export function isVisibleAndMeaningful(el: Element): boolean {
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
export function isBackgroundVideo(video: HTMLVideoElement): boolean {
  return video.muted && video.loop;
}

/**
 * 通用视频候选评分（M4-02）。分数越高越可能是主播放器。
 *
 * 评分因素：可见面积（主要）、是否正在播放（加分）、是否静音（减分）。
 * 不分析滚动速度、阅读行为或用户注意力。
 */
export function scoreVideoCandidate(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const area = rect.width * rect.height;
  let score = area;
  if (!video.paused && !video.ended) {
    score *= 1.2; // 正在播放的视频更可能是主播放器
  }
  if (video.muted) {
    score *= 0.5; // 静音视频更可能是背景或预览
  }
  return score;
}

/**
 * 在页面中查找主视频候选（通用视频模式）。
 * 遍历所有 <video>，过滤不可见/背景视频，返回评分最高者。
 * 找不到可靠视频时返回 null。
 */
export function findPrimaryVideoGeneric(): HTMLVideoElement | null {
  const candidates = document.querySelectorAll<HTMLVideoElement>('video');
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const video of candidates) {
    if (!isVisibleAndMeaningful(video)) continue;
    if (isBackgroundVideo(video)) continue;
    const score = scoreVideoCandidate(video);
    if (score > bestScore) {
      bestScore = score;
      best = video;
    }
  }
  return best;
}

/**
 * 获取通用视频身份标识。身份变化才视为新视频。
 * 优先使用 src；无 src 时回退到尺寸+位置哈希。
 */
export function getGenericVideoIdentity(video: HTMLVideoElement): string | null {
  const src = video.currentSrc || video.src;
  if (src) return `generic:${src}`;
  const rect = video.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return `generic:${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.left)},${Math.round(rect.top)}`;
}

/**
 * 能力检测（Issue #11 AC2 / AC4）。
 *
 * 在当前页面查找可靠主视频：
 * - 找到 → 'generic-video'（可控视频，全网页遮罩）；
 * - 未找到 → 'basic-web'（无可靠视频，页面加载/滚动触发）。
 *
 * 检测失败（抛异常）时降级为 'basic-web'，不阻塞页面（AC4）。
 */
export function detectSiteCapability(): SiteMode {
  try {
    const video = findPrimaryVideoGeneric();
    return video !== null ? 'generic-video' : 'basic-web';
  } catch (error) {
    console.error('[BingeUp] 能力检测失败，降级为基础网页模式', error);
    return 'basic-web';
  }
}
