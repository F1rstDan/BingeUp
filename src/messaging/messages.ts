import type { AppSettings, CooldownState, SiteSettings } from '@/types';
import type { ExportPayload, ImportResult } from '@/storage/data-transfer';

/**
 * Background ↔ Content Script / Popup 消息协议（M1-02 / Issue #9 / #10）。
 * Background 负责共享全局冷却、站点权限/状态、引导状态、全局暂停、
 * 应用设置与本地数据管理，以及消息分发。
 */

export type ExtensionMessage =
  | { type: 'COOLDOWN_GET_STATUS' }
  | { type: 'COOLDOWN_COMPLETE_QUESTION' }
  | { type: 'COOLDOWN_SKIP_QUESTION' }
  | { type: 'SITE_GET_STATE'; hostname: string }
  | { type: 'SITE_MARK_FIRST_QUESTION_HANDLED'; hostname: string }
  // ─── Issue #9：安装引导、可选权限与 Popup 控制 ──────────────
  /** 完成引导：标记 onboardingCompleted，并同步受支持站点的启用选择。 */
  | { type: 'ONBOARDING_COMPLETE'; hostnames: string[] }
  /** 启用当前网站（Popup / 启用提示）。 */
  | { type: 'SITE_ENABLE'; hostname: string }
  /** 暂停当前网站（AC4）。 */
  | { type: 'SITE_DISABLE'; hostname: string }
  /** 暂停全部网站（AC4）。 */
  | { type: 'PAUSE_ALL' }
  /** 暂停 10 分钟，Popup 用倒计时显示剩余时间。 */
  | { type: 'PAUSE_TEN_MINUTES' }
  /** 暂停今天（AC4）。 */
  | { type: 'PAUSE_TODAY'; now: number }
  /** 恢复全部网站。 */
  | { type: 'RESUME_ALL' }
  /** 查询全局暂停状态，供内容侧主动学习入口做最终状态检查。 */
  | { type: 'GET_GLOBAL_PAUSE_STATUS' }
  /** 记录一次启用提示拒绝（AC2）。 */
  | { type: 'PROMPT_DECLINE'; hostname: string }
  /** 查询 Popup 需要的站点/引导/暂停数据（AC3）。 */
  | { type: 'GET_POPUP_DATA'; hostname: string }
  // ─── Issue #10：设置页与本地数据管理 ──────────────────────
  /** 读取应用设置（AC1）。 */
  | { type: 'GET_APP_SETTINGS' }
  /** 保存应用设置（先校验自动修正再持久化，AC3）。 */
  | { type: 'SET_APP_SETTINGS'; settings: AppSettings }
  /** 恢复默认应用设置。 */
  | { type: 'RESET_APP_SETTINGS' }
  /** 列出所有已持久化的站点设置（AC2 站点管理）。 */
  | { type: 'LIST_SITES' }
  /** 删除自定义网站并释放可选权限（AC5）。 */
  | { type: 'REMOVE_SITE'; hostname: string }
  /** 导出本地全部数据（AC4）。 */
  | { type: 'EXPORT_DATA' }
  /** 导入本地数据：先校验再写入（AC4）。 */
  | { type: 'IMPORT_DATA'; payload: unknown }
  /** 清除学习进度：只清空 cards/reviewLogs（AC4）。 */
  | { type: 'CLEAR_LEARNING_PROGRESS' }
  /** 清除全部本地数据（AC4）。 */
  | { type: 'CLEAR_ALL_DATA' }
  /** 数据库无法打开时，由用户二次确认后删除并重建。 */
  | { type: 'REBUILD_DATABASE' }
  // ─── Issue #11：自定义网站兼容模式 ─────────────────────
  /** 加入当前网站：启用站点并写入默认模式，用户需刷新页面激活。 */
  | { type: 'ADD_CUSTOM_SITE'; hostname: string }
  /** 更新站点兼容模式（内容脚本能力检测后回写，AC4）。 */
  | { type: 'UPDATE_SITE_MODE'; hostname: string; mode: SiteSettings['mode'] };

/** Background 返回给 Content 的冷却状态。 */
export interface CooldownStatusResponse extends CooldownState {}

/** Background 返回给 Content 的站点状态。 */
export interface SiteStateResponse extends SiteSettings {
  hostname: string;
}

/** Background 返回给 Popup 的综合数据（AC3）。 */
export interface PopupDataResponse {
  site: SiteStateResponse;
  onboardingCompleted: boolean;
  globalPausedUntil: number;
  /** 本地学习统计；数据库不可用时缺省，不能阻塞面板状态显示。 */
  stats?: PopupLearningStats;
}

export interface PopupLearningStats {
  today: {
    completedQuestions: number;
  };
  cardStatus: {
    longTerm: number;
  };
  dueReviewCount: number;
}

/** 暂停操作返回新的全局暂停到期时间戳。 */
export interface PauseResponse {
  globalPausedUntil: number;
}

// ─── Issue #10 响应类型 ───────────────────────────────────────

/** 站点列表响应（AC2）。 */
export interface SiteListResponse {
  sites: { hostname: string; settings: SiteSettings }[];
}

/** 删除站点响应：released 表示是否成功释放了可选权限（AC5）。 */
export interface RemoveSiteResponse {
  released: boolean;
}

/** 导出数据响应：直接返回 ExportPayload（AC4）。 */
export type ExportDataResponse = ExportPayload;

/** 导入数据响应（AC4）。 */
export type ImportDataResponse = ImportResult;

/**
 * Popup → Content Script 消息（通过 chrome.tabs.sendMessage 发送）。
 * 与 ExtensionMessage 分开，因为走不同的消息通道。
 */
export type ContentMessage =
  | { type: 'START_CONTINUOUS_LEARNING' };

export type StartLearningFailureReason =
  | 'globally-paused'
  | 'interaction-active'
  | 'context-unavailable'
  | 'no-learning-content'
  | 'failed';

export type StartLearningResponse =
  | { ok: true }
  | { ok: false; reason: StartLearningFailureReason };
