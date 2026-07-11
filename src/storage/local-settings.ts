import type { CooldownState, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

const STORAGE_KEY = 'bingeup:state';

interface PersistedState {
  cooldown: CooldownState;
  sites: Record<string, SiteSettings>;
}

const DEFAULT_STATE: PersistedState = {
  cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 },
  sites: {},
};

function defaultSiteSettings(): SiteSettings {
  return { enabled: true, mode: 'full-adaptation', firstQuestionPending: true };
}

/**
 * chrome.storage.local 封装（M2-02）。持久化冷却状态与站点设置；
 * 浏览器重启后状态仍正确。
 */
export class LocalSettingsStore {
  async read(): Promise<PersistedState> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as PersistedState | undefined;
    if (!stored) {
      return { ...DEFAULT_STATE };
    }
    return {
      cooldown: { ...DEFAULT_STATE.cooldown, ...stored.cooldown },
      sites: { ...stored.sites },
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
    return state.sites[hostname] ?? defaultSiteSettings();
  }

  async setSite(hostname: string, settings: SiteSettings): Promise<void> {
    const state = await this.read();
    state.sites[hostname] = settings;
    await this.write(state);
  }

  async markFirstQuestionHandled(hostname: string): Promise<void> {
    const state = await this.read();
    const site = state.sites[hostname] ?? defaultSiteSettings();
    if (site.firstQuestionPending) {
      site.firstQuestionPending = false;
      state.sites[hostname] = site;
      await this.write(state);
    }
  }

  /** 启用一个站点：默认进入首次触发待处理状态。 */
  async enableSite(hostname: string, mode: SiteSettings['mode'] = 'full-adaptation'): Promise<void> {
    await this.setSite(hostname, { enabled: true, mode, firstQuestionPending: true });
  }
}

/** 默认冷却配置（从应用设置派生）。 */
export function defaultCooldownConfig() {
  return {
    defaultCooldownMinutes: DEFAULT_SETTINGS.defaultCooldownMinutes,
    consecutiveSkipCooldowns: DEFAULT_SETTINGS.consecutiveSkipCooldowns,
  };
}
