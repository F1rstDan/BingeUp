import type { CooldownState, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import {
  isBilibiliHostname,
  isSupportedHostname,
  isYouTubeHostname,
} from '@/sites/supported-sites';
import { recordPromptDecline as recordPromptDeclinePure } from '@/onboarding/onboarding-service';

const STORAGE_KEY = 'bingeup:state';

interface PersistedState {
  cooldown: CooldownState;
  sites: Record<string, SiteSettings>;
  /** 引导是否已完成（Issue #9）。 */
  onboardingCompleted: boolean;
  /** 全局暂停到期时间戳（ms）；0 表示未暂停（Issue #9 AC4）。 */
  globalPausedUntil: number;
}

const DEFAULT_STATE: PersistedState = {
  cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 },
  sites: {},
  onboardingCompleted: false,
  globalPausedUntil: 0,
};

function unsupportedSiteSettings(): SiteSettings {
  return { enabled: false, mode: 'unsupported', firstQuestionPending: false };
}

/**
 * 规范站点键（Issue #9）。
 * Bilibili / YouTube 任意子域名映射到根域名，确保引导启用一次后全站生效；
 * 其他主机名按原样返回（自定义站点，未来 Issue 处理）。
 */
export function canonicalSiteKey(hostname: string): string {
  if (isBilibiliHostname(hostname)) return 'bilibili.com';
  if (isYouTubeHostname(hostname)) return 'youtube.com';
  return hostname;
}

/**
 * 受支持站点的默认设置（Issue #9 后默认未启用，等待引导或启用提示开启）。
 * 未启用时不保留首次触发；启用操作（enableSite）会重新置 firstQuestionPending=true。
 */
function defaultSiteSettings(hostname: string): SiteSettings {
  if (!isSupportedHostname(hostname)) return unsupportedSiteSettings();
  return { enabled: false, mode: 'full-adaptation', firstQuestionPending: false };
}

function normalizeSiteSettings(hostname: string, settings: SiteSettings): SiteSettings {
  return isSupportedHostname(hostname) ? settings : unsupportedSiteSettings();
}

/**
 * chrome.storage.local 封装（M2-02 / Issue #9）。持久化冷却状态、站点设置、
 * 引导状态与全局暂停；浏览器重启后状态仍正确。
 */
export class LocalSettingsStore {
  async read(): Promise<PersistedState> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as PersistedState | undefined;
    if (!stored) {
      return {
        cooldown: { ...DEFAULT_STATE.cooldown },
        sites: { ...DEFAULT_STATE.sites },
        onboardingCompleted: DEFAULT_STATE.onboardingCompleted,
        globalPausedUntil: DEFAULT_STATE.globalPausedUntil,
      };
    }
    return {
      cooldown: { ...DEFAULT_STATE.cooldown, ...stored.cooldown },
      sites: { ...stored.sites },
      onboardingCompleted: stored.onboardingCompleted ?? false,
      globalPausedUntil: stored.globalPausedUntil ?? 0,
    };
  }

  async write(state: PersistedState): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async getCooldown(): Promise<CooldownState> {
    return (await this.read()).cooldown;
  }

  async setCooldown(cooldown: CooldownState): Promise<void> {
    const state = await this.read();
    state.cooldown = cooldown;
    await this.write(state);
  }

  async getSite(hostname: string): Promise<SiteSettings> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const stored = state.sites[key];
    return stored ? normalizeSiteSettings(hostname, stored) : defaultSiteSettings(hostname);
  }

  async setSite(hostname: string, settings: SiteSettings): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    state.sites[key] = normalizeSiteSettings(hostname, settings);
    await this.write(state);
  }

  async markFirstQuestionHandled(hostname: string): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const site = normalizeSiteSettings(
      hostname,
      state.sites[key] ?? defaultSiteSettings(hostname),
    );
    if (site.firstQuestionPending) {
      site.firstQuestionPending = false;
      state.sites[key] = site;
      await this.write(state);
    }
  }

  /** 启用一个站点：默认进入首次触发待处理状态。 */
  async enableSite(hostname: string, mode: SiteSettings['mode'] = 'full-adaptation'): Promise<void> {
    await this.setSite(hostname, { enabled: true, mode, firstQuestionPending: true });
  }

  /** 暂停当前网站（AC4）：将 enabled 置为 false，保留其他字段。 */
  async disableSite(hostname: string): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const current = state.sites[key] ?? defaultSiteSettings(hostname);
    state.sites[key] = normalizeSiteSettings(hostname, { ...current, enabled: false });
    await this.write(state);
  }

  /** 记录一次启用提示拒绝（AC2）。 */
  async recordPromptDecline(hostname: string): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const current = state.sites[key] ?? defaultSiteSettings(hostname);
    state.sites[key] = normalizeSiteSettings(hostname, recordPromptDeclinePure(current));
    await this.write(state);
  }

  async isOnboardingCompleted(): Promise<boolean> {
    return (await this.read()).onboardingCompleted;
  }

  async markOnboardingCompleted(): Promise<void> {
    const state = await this.read();
    state.onboardingCompleted = true;
    await this.write(state);
  }

  async getGlobalPausedUntil(): Promise<number> {
    return (await this.read()).globalPausedUntil;
  }

  async setGlobalPausedUntil(until: number): Promise<void> {
    const state = await this.read();
    state.globalPausedUntil = until;
    await this.write(state);
  }
}

/** 默认冷却配置（从应用设置派生）。 */
export function defaultCooldownConfig() {
  return {
    defaultCooldownMinutes: DEFAULT_SETTINGS.defaultCooldownMinutes,
    consecutiveSkipCooldowns: DEFAULT_SETTINGS.consecutiveSkipCooldowns,
  };
}
