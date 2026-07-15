import type { SiteMode } from '@/types';
import { MIN_VIDEO_HEIGHT, MIN_VIDEO_WIDTH, selectPrimaryVideo } from '@/adapters/video-candidates';

/** 视频被视为"有意义主播放器"的最小可见尺寸（px）。 */
export { MIN_VIDEO_WIDTH, MIN_VIDEO_HEIGHT };

/** 明显滚动的累计阈值（px）；超过后触发一次基础网页模式学习（Issue #11 AC3）。 */
export const SCROLL_TRIGGER_THRESHOLD_PX = 2000;
const elementIdentities = new WeakMap<HTMLVideoElement, string>();
let nextElementIdentity = 1;

/**
 * 在页面中查找主视频候选（通用视频模式）。
 * 遍历所有 <video>，过滤不可见/背景视频，返回评分最高者。
 * 找不到可靠视频时返回 null。
 */
export function findPrimaryVideoGeneric(): HTMLVideoElement | null {
  return selectPrimaryVideo(document.querySelectorAll<HTMLVideoElement>('video'));
}

/**
 * 获取通用视频身份标识。身份变化才视为新视频。
 * 优先使用 src；无 src 时为当前视频元素分配稳定身份，避免滚动/布局变化误触发。
 */
export function getGenericVideoIdentity(video: HTMLVideoElement): string | null {
  const src = video.currentSrc || video.src;
  if (src) return `generic:${src}`;
  const rect = video.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const existing = elementIdentities.get(video);
  if (existing) return existing;
  const identity = `generic:element:${nextElementIdentity++}`;
  elementIdentities.set(video, identity);
  return identity;
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
