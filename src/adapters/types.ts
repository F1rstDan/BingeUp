import type { OverlayMode, VideoChangeEvent } from '@/types';

/**
 * 站点适配器接口（M4-01）。官方适配器负责路由/视频身份识别、主播放器选择、
 * 广告/预览过滤与直播识别；通用与基础适配器不得把网站选择器泄漏到编排层。
 */
export interface VideoSiteAdapter {
  id: string;
  /** Whether the adapter can provide a no-video, full-page learning context. */
  readonly supportsBasicContext?: boolean;
  /** False when repeated same-video timed learning does not apply to this adapter. */
  readonly supportsTimedLearning?: boolean;

  /** 当前 location 是否由本适配器处理。 */
  matches(location: Location): boolean;

  /**
   * 订阅视频变化。当识别到新视频（身份变化）时调用 onVideoChanged。
   * 返回取消订阅函数。
   */
  observePageChanges(onVideoChanged: (event: VideoChangeEvent) => void): () => void;

  /** 查找当前页面的主视频。 */
  findPrimaryVideo(): HTMLVideoElement | null;

  /** 获取视频身份标识；变化才视为新视频。 */
  getVideoIdentity(video: HTMLVideoElement): string | null;

  /** 获取遮罩定位目标（视频区域元素或矩形）。 */
  getOverlayTarget(video: HTMLVideoElement): HTMLElement | DOMRect | null;

  /** 遮罩覆盖方式。 */
  getOverlayMode(): OverlayMode;

  /** 是否广告视频。 */
  isAdvertisement(video: HTMLVideoElement): boolean;

  /** 是否预览/悬停视频。 */
  isPreview(video: HTMLVideoElement): boolean;

  /** 是否直播页。 */
  isLivePage(): boolean;
}
