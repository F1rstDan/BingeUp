/**
 * 刷刷升级共享领域类型。术语遵循 CONTEXT.md。
 */

/** 网站兼容等级（CONTEXT.md：完整适配 / 通用视频模式 / 基础网页模式 / 不支持）。_Avoid_: official */
export type SiteMode = 'full-adaptation' | 'generic-video' | 'basic-web' | 'unsupported';

/** 遮罩覆盖方式 */
export type OverlayMode = 'video-region' | 'full-page';

/** 学习模式 */
export type LearningMode = 'single' | 'continuous';

/** 全局冷却状态：只持久化这两个字段（见规格 Implementation Decisions）。 */
export interface CooldownState {
  /** 下次允许触发的时间戳（ms）。 */
  nextAllowedAt: number;
  /** 连续跳过次数。正常完成题目后清零。 */
  consecutiveSkipCount: number;
}

/** 站点设置 */
export interface SiteSettings {
  enabled: boolean;
  mode: SiteMode;
  /** 首次触发是否仍待处理。 */
  firstQuestionPending: boolean;
}

/** 应用设置（第一条纵向切片只用到冷却相关字段；其余字段由后续 Issue 引入）。 */
export interface AppSettings {
  defaultCooldownMinutes: number;
  consecutiveSkipCooldowns: number[];
}

/** 视频播放快照：用于在交互后恢复正确播放状态。 */
export interface PlaybackSnapshot {
  wasPlaying: boolean;
  currentTime: number;
  playbackRate: number;
}

/** 视频变化事件：由站点适配器发出。 */
export interface VideoChangeEvent {
  /** 视频身份标识；变化才视为新视频。 */
  identity: string;
  video: HTMLVideoElement | null;
  overlayTarget: HTMLElement | DOMRect | null;
  overlayMode: OverlayMode;
}

/** 用户在单题交互中的结果。 */
export type InteractionOutcome = 'submitted' | 'skipped';
