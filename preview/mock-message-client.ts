import type {
  AnswerSubmission,
  AppSettings,
  CorrectionResult,
  LearningItem,
  SelfRatedLevel,
  SessionLogRecord,
  SiteMode,
  SiteSettings,
  SpellingSubmission,
  SubmissionResult,
  UserCorrection,
} from '@/types';
import type {
  CooldownStatusResponse,
  ExportDataResponse,
  ImportDataResponse,
  PauseResponse,
  PopupDataResponse,
  RemoveSiteResponse,
  SiteListResponse,
  SiteStateResponse,
} from '@/messaging/messages';
import type { DataOperationResult } from '@/storage/data-transfer';

import {
  DEMO_APP_SETTINGS,
  DEMO_SITE_SETTINGS,
  makeDemoNewWordItem,
  makeDemoPopupStats,
  makeDemoSubmissionResult,
} from './demo-data';

/**
 * 真实消息客户端的公开类型（仅在编译期使用）。
 *
 * mock 通过下面的 `satisfies` 约束与真实模块结构兼容：若 src/messaging/message-client.ts
 * 新增/修改公开方法，这里会直接类型报错，避免 mock 静默漂移。
 */
type RealMessageClient = typeof import('@/messaging/message-client').messageClient;

/**
 * 预览站的消息客户端 mock（vite.preview.config.ts 精确替换 @/messaging/message-client）。
 *
 * 公开 API 与 src/messaging/message-client.ts 一一对应；返回值使用真实类型，
 * 数据为演示数据。写操作提供“最小合理行为”：直接改内存中的演示状态并返回与
 * 真实后台一致的响应形态，让预览页的交互链路（开关、保存、暂停、加入网站等）
 * 可以走完整流程而不报错。这里不模拟冷却、FSRS 调度与持久化。
 */

interface PreviewDemoState {
  settings: AppSettings;
  sites: Record<string, SiteSettings>;
  onboardingCompleted: boolean;
  globalPausedUntil: number;
}

function cloneSite(settings: SiteSettings): SiteSettings {
  return { ...settings };
}

/** 镜像 @/storage/local-settings 的 canonicalSiteKey 最小逻辑（预览页不引入存储层）。 */
function canonicalSiteKey(hostname: string): string {
  if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili.com';
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    return hostname === 'music.youtube.com' ? hostname : 'youtube.com';
  }
  return hostname;
}

function unsupportedSite(): SiteSettings {
  return { enabled: false, mode: 'unsupported', firstQuestionPending: false };
}

export const previewDemoState: PreviewDemoState = {
  settings: { ...DEMO_APP_SETTINGS },
  sites: Object.fromEntries(
    Object.entries(DEMO_SITE_SETTINGS).map(([hostname, settings]) => [
      hostname,
      cloneSite(settings),
    ]),
  ),
  onboardingCompleted: true,
  globalPausedUntil: 0,
};

/** 重置演示状态（预览页切换场景时可调用）。 */
export function resetPreviewDemoState(): void {
  previewDemoState.settings = { ...DEMO_APP_SETTINGS };
  previewDemoState.sites = Object.fromEntries(
    Object.entries(DEMO_SITE_SETTINGS).map(([hostname, settings]) => [
      hostname,
      cloneSite(settings),
    ]),
  );
  previewDemoState.onboardingCompleted = true;
  previewDemoState.globalPausedUntil = 0;
}

/** 设置全局暂停截止时间（Popup「已暂停」预览使用）。 */
export function setPreviewGlobalPause(until: number): void {
  previewDemoState.globalPausedUntil = until;
}

function siteState(hostname: string): SiteStateResponse {
  const key = canonicalSiteKey(hostname);
  const settings = previewDemoState.sites[key] ?? unsupportedSite();
  return { hostname: key, ...cloneSite(settings) };
}

function setSiteEnabledState(hostname: string, enabled: boolean): SiteStateResponse {
  const key = canonicalSiteKey(hostname);
  const current = previewDemoState.sites[key] ?? {
    enabled: false,
    mode: 'generic-video' as SiteMode,
    firstQuestionPending: true,
  };
  previewDemoState.sites[key] = { ...current, enabled };
  return siteState(hostname);
}

export const messageClient = {
  async prepareContent(): Promise<void> {
    return undefined;
  },
  async getCooldownStatus(): Promise<CooldownStatusResponse> {
    return { nextAllowedAt: Date.now() + 2 * 60 * 1000, consecutiveSkipCount: 0 };
  },
  async completeQuestion(): Promise<CooldownStatusResponse> {
    return { nextAllowedAt: Date.now() + 2 * 60 * 1000, consecutiveSkipCount: 0 };
  },
  async skipQuestion(): Promise<CooldownStatusResponse> {
    return { nextAllowedAt: Date.now() + 5 * 60 * 1000, consecutiveSkipCount: 1 };
  },
  async getNextLearningItem(options?: {
    excludedWordIds?: Set<string>;
    allowSpelling?: boolean;
    allowEarlyShortTermReview?: boolean;
  }): Promise<LearningItem | null> {
    const item = makeDemoNewWordItem();
    if (
      item.kind === 'new-word-presentation' &&
      options?.excludedWordIds?.has(item.presentation.word.id)
    ) {
      return null;
    }
    return item;
  },
  async acceptNewWord(wordId: string): Promise<void> {
    console.debug('[preview] acceptNewWord', wordId);
  },
  async selfReportKnown(wordId: string): Promise<void> {
    console.debug('[preview] selfReportKnown', wordId);
  },
  async submitLearningAnswer(submission: AnswerSubmission): Promise<SubmissionResult> {
    const isCorrect = submission.selectedIndex === submission.question.correctIndex;
    return makeDemoSubmissionResult(submission.question, isCorrect);
  },
  async submitLearningSpelling(submission: SpellingSubmission): Promise<SubmissionResult> {
    const normalized = submission.spelledAnswer.trim().toLowerCase();
    const acceptable = (submission.question.acceptableAnswers ?? []).map((answer) =>
      answer.trim().toLowerCase(),
    );
    const isCorrect =
      normalized === submission.question.correctAnswer.trim().toLowerCase() ||
      acceptable.includes(normalized);
    return makeDemoSubmissionResult(submission.question, isCorrect);
  },
  async correctLearningRating(
    reviewLogId: string,
    correction: UserCorrection,
  ): Promise<CorrectionResult> {
    return {
      cardId: 'demo-card-deliberate',
      reviewLogId,
      rating: correction === 'guessed' ? 'again' : 'easy',
      nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  },
  async saveLearningSession(log: SessionLogRecord): Promise<void> {
    console.debug('[preview] saveLearningSession', log.id);
  },
  async getSiteState(hostname: string): Promise<SiteStateResponse> {
    return siteState(hostname);
  },
  async markFirstQuestionHandled(hostname: string): Promise<SiteStateResponse> {
    return siteState(hostname);
  },
  async completeOnboarding(params: {
    hostnames: string[];
    deckId: string;
    selfRatedLevel: SelfRatedLevel;
  }): Promise<void> {
    previewDemoState.onboardingCompleted = true;
    previewDemoState.settings = {
      ...previewDemoState.settings,
      selectedDeckId: params.deckId,
      selfRatedLevel: params.selfRatedLevel,
    };
    for (const hostname of params.hostnames) {
      previewDemoState.sites[canonicalSiteKey(hostname)] = {
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: true,
      };
    }
  },
  async enableSite(hostname: string): Promise<SiteStateResponse> {
    return setSiteEnabledState(hostname, true);
  },
  async disableSite(hostname: string): Promise<SiteStateResponse> {
    return setSiteEnabledState(hostname, false);
  },
  async setSiteEnabled(hostname: string, enabled: boolean): Promise<SiteStateResponse> {
    return setSiteEnabledState(hostname, enabled);
  },
  async pauseTenMinutes(): Promise<PauseResponse> {
    previewDemoState.globalPausedUntil = Date.now() + 10 * 60 * 1000;
    return { globalPausedUntil: previewDemoState.globalPausedUntil };
  },
  async pauseToday(now: number): Promise<PauseResponse> {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    previewDemoState.globalPausedUntil = end.getTime();
    return { globalPausedUntil: previewDemoState.globalPausedUntil };
  },
  async resumeGlobalPause(): Promise<PauseResponse> {
    previewDemoState.globalPausedUntil = 0;
    return { globalPausedUntil: 0 };
  },
  async getGlobalPauseStatus(): Promise<PauseResponse> {
    return { globalPausedUntil: previewDemoState.globalPausedUntil };
  },
  async claimPlaybackRecoveryNotice(now: number): Promise<boolean> {
    console.debug('[preview] claimPlaybackRecoveryNotice', now > 0);
    return true;
  },
  async recordPromptDecline(hostname: string): Promise<void> {
    const key = canonicalSiteKey(hostname);
    const current = previewDemoState.sites[key] ?? unsupportedSite();
    previewDemoState.sites[key] = {
      ...current,
      promptDeclineCount: (current.promptDeclineCount ?? 0) + 1,
    };
  },
  async getPopupData(hostname: string): Promise<PopupDataResponse> {
    return {
      site: siteState(hostname),
      onboardingCompleted: previewDemoState.onboardingCompleted,
      globalPausedUntil: previewDemoState.globalPausedUntil,
      stats: makeDemoPopupStats(),
    };
  },

  // ─── 设置页与本地数据管理 ─────────────────────────────────
  async getAppSettings(): Promise<AppSettings> {
    return { ...previewDemoState.settings };
  },
  async setAppSettings(settings: AppSettings): Promise<AppSettings> {
    previewDemoState.settings = { ...settings };
    return { ...previewDemoState.settings };
  },
  async resetAppSettings(): Promise<AppSettings> {
    previewDemoState.settings = { ...DEMO_APP_SETTINGS };
    return { ...previewDemoState.settings };
  },
  async listSites(): Promise<SiteListResponse> {
    return {
      sites: Object.entries(previewDemoState.sites).map(([hostname, settings]) => ({
        hostname,
        settings: cloneSite(settings),
      })),
    };
  },
  async updateSiteTriggers(
    hostname: string,
    triggers: Pick<SiteSettings, 'pageLoadTrigger' | 'scrollTrigger'>,
  ): Promise<SiteStateResponse> {
    const key = canonicalSiteKey(hostname);
    const current = previewDemoState.sites[key] ?? unsupportedSite();
    previewDemoState.sites[key] = { ...current, ...triggers };
    return siteState(hostname);
  },
  async removeSite(hostname: string): Promise<RemoveSiteResponse> {
    delete previewDemoState.sites[canonicalSiteKey(hostname)];
    return { released: true };
  },
  async exportData(): Promise<ExportDataResponse> {
    return {
      version: 1,
      exportedAt: Date.now(),
      authoritativeState: {
        appSettings: { ...previewDemoState.settings },
        sites: Object.fromEntries(
          Object.entries(previewDemoState.sites).map(([hostname, settings]) => [
            hostname,
            cloneSite(settings),
          ]),
        ),
        onboardingCompleted: previewDemoState.onboardingCompleted,
      },
      data: {
        cards: [],
        reviewLogs: [],
        sessionLogs: [],
        behaviorEvents: [],
        words: [],
        decks: [],
      },
    };
  },
  async importData(payload: unknown): Promise<ImportDataResponse> {
    console.debug('[preview] importData', payload);
    return { ok: true, errors: [], warnings: [] };
  },
  async clearLearningProgress(): Promise<void> {},
  async clearAllData(): Promise<DataOperationResult> {
    return { ok: true, errors: [], warnings: [] };
  },
  async rebuildDatabase(): Promise<DataOperationResult> {
    resetPreviewDemoState();
    return { ok: true, errors: [], warnings: [] };
  },

  // ─── 自定义网站兼容模式 ───────────────────────────────────
  async addCustomSite(hostname: string): Promise<SiteStateResponse> {
    const key = canonicalSiteKey(hostname);
    previewDemoState.sites[key] = {
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: true,
      pageLoadTrigger: true,
      scrollTrigger: true,
    };
    return siteState(hostname);
  },
  async updateSiteMode(hostname: string, mode: SiteMode): Promise<void> {
    const key = canonicalSiteKey(hostname);
    const current = previewDemoState.sites[key] ?? unsupportedSite();
    previewDemoState.sites[key] = { ...current, mode };
  },
} satisfies RealMessageClient;
