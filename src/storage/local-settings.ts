import type { AppSettings, CooldownState, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { normalizeAppSettings, normalizeSiteSettings as normalizeSiteSettingsPure } from '@/settings/validator';
import { isBilibiliHostname, isSupportedHostname, isYouTubeHostname } from '@/sites/supported-sites';
import { recordPromptDecline as recordPromptDeclinePure } from '@/onboarding/onboarding-service';
import { STORES, idbGet, idbPut } from '@/storage/database';

const RUNTIME_STORAGE_KEY = 'bingeup:runtime';
export const AUTHORITATIVE_STATE_ID = 'current';

/** IndexedDB 中唯一的长期权威状态记录。 */
export interface AuthoritativeStateRecord {
  id: typeof AUTHORITATIVE_STATE_ID;
  appSettings: AppSettings;
  sites: Record<string, SiteSettings>;
  onboardingCompleted: boolean;
}

/** chrome.storage.local 中可安全丢弃、不进入备份的临时运行状态。 */
export interface RuntimeState {
  cooldown: CooldownState;
  globalPausedUntil: number;
}

/** 兼容业务层一次读取两类状态；不代表它们共享持久化边界。 */
export interface PersistedState extends AuthoritativeStateRecord, RuntimeState {}

export const DEFAULT_AUTHORITATIVE_STATE: AuthoritativeStateRecord = {
  id: AUTHORITATIVE_STATE_ID,
  appSettings: { ...DEFAULT_SETTINGS },
  sites: {},
  onboardingCompleted: false,
};

const DEFAULT_RUNTIME_STATE: RuntimeState = {
  cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 },
  globalPausedUntil: 0,
};

export function canonicalSiteKey(hostname: string): string {
  if (isBilibiliHostname(hostname)) return 'bilibili.com';
  if (isYouTubeHostname(hostname)) return 'youtube.com';
  return hostname;
}

function unsupportedSiteSettings(): SiteSettings {
  return { enabled: false, mode: 'unsupported', firstQuestionPending: false };
}

function defaultSiteSettings(hostname: string): SiteSettings {
  if (!isSupportedHostname(hostname)) return unsupportedSiteSettings();
  return { enabled: true, mode: 'full-adaptation', firstQuestionPending: true };
}

function normalizeSiteSettings(hostname: string, settings: SiteSettings): SiteSettings {
  if (isSupportedHostname(hostname)) return normalizeSiteSettingsPure(settings);
  if (settings.mode === 'full-adaptation') {
    return normalizeSiteSettingsPure({ ...settings, mode: 'generic-video' });
  }
  return normalizeSiteSettingsPure(settings);
}

function copyAuthoritativeState(state: AuthoritativeStateRecord): AuthoritativeStateRecord {
  return {
    id: AUTHORITATIVE_STATE_ID,
    appSettings: normalizeAppSettings(state.appSettings),
    sites: Object.fromEntries(Object.entries(state.sites).map(([hostname, settings]) => [
      hostname,
      normalizeSiteSettings(hostname, settings),
    ])),
    onboardingCompleted: state.onboardingCompleted,
  };
}

export class LocalSettingsStore {
  constructor(readonly database: IDBDatabase) {}

  private updateAuthoritativeState(
    update: (state: AuthoritativeStateRecord) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.authoritativeState, 'readwrite');
      const objectStore = transaction.objectStore(STORES.authoritativeState);
      const request = objectStore.get(AUTHORITATIVE_STATE_ID);
      request.onsuccess = () => {
        const state = request.result
          ? copyAuthoritativeState(request.result as AuthoritativeStateRecord)
          : copyAuthoritativeState(DEFAULT_AUTHORITATIVE_STATE);
        update(state);
        objectStore.put(copyAuthoritativeState(state));
      };
      request.onerror = () => reject(request.error ?? new Error('读取权威状态失败'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('更新权威状态失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('更新权威状态事务已中止'));
    });
  }

  async getAuthoritativeState(): Promise<AuthoritativeStateRecord> {
    const stored = await idbGet<AuthoritativeStateRecord>(
      this.database,
      STORES.authoritativeState,
      AUTHORITATIVE_STATE_ID,
    );
    return stored ? copyAuthoritativeState(stored) : copyAuthoritativeState(DEFAULT_AUTHORITATIVE_STATE);
  }

  async setAuthoritativeState(state: AuthoritativeStateRecord): Promise<void> {
    await idbPut(this.database, STORES.authoritativeState, copyAuthoritativeState(state));
  }

  async getRuntimeState(): Promise<RuntimeState> {
    const result = await chrome.storage.local.get(RUNTIME_STORAGE_KEY);
    const stored = result[RUNTIME_STORAGE_KEY] as Partial<RuntimeState> | undefined;
    return {
      cooldown: { ...DEFAULT_RUNTIME_STATE.cooldown, ...stored?.cooldown },
      globalPausedUntil: stored?.globalPausedUntil ?? 0,
    };
  }

  async setRuntimeState(state: RuntimeState): Promise<void> {
    await chrome.storage.local.set({ [RUNTIME_STORAGE_KEY]: state });
  }

  async resetRuntimeState(): Promise<void> {
    await this.setRuntimeState({
      cooldown: { ...DEFAULT_RUNTIME_STATE.cooldown },
      globalPausedUntil: DEFAULT_RUNTIME_STATE.globalPausedUntil,
    });
  }

  async read(): Promise<PersistedState> {
    const [authoritative, runtime] = await Promise.all([
      this.getAuthoritativeState(),
      this.getRuntimeState(),
    ]);
    return { ...authoritative, ...runtime };
  }

  async getCooldown(): Promise<CooldownState> { return (await this.getRuntimeState()).cooldown; }
  async setCooldown(cooldown: CooldownState): Promise<void> {
    const runtime = await this.getRuntimeState();
    await this.setRuntimeState({ ...runtime, cooldown });
  }

  async getSite(hostname: string): Promise<SiteSettings> {
    const state = await this.getAuthoritativeState();
    const stored = state.sites[canonicalSiteKey(hostname)];
    return stored ? normalizeSiteSettings(hostname, stored) : defaultSiteSettings(hostname);
  }

  async setSite(hostname: string, settings: SiteSettings): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      state.sites[canonicalSiteKey(hostname)] = normalizeSiteSettings(hostname, settings);
    });
  }

  async markFirstQuestionHandled(hostname: string): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      const key = canonicalSiteKey(hostname);
      const site = normalizeSiteSettings(hostname, state.sites[key] ?? defaultSiteSettings(hostname));
      if (site.firstQuestionPending) state.sites[key] = { ...site, firstQuestionPending: false };
    });
  }

  async enableSite(hostname: string, mode: SiteSettings['mode'] = 'full-adaptation'): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      const key = canonicalSiteKey(hostname);
      const current = normalizeSiteSettings(hostname, state.sites[key] ?? defaultSiteSettings(hostname));
      const enabled = normalizeSiteSettings(hostname, { enabled: true, mode, firstQuestionPending: true });
      state.sites[key] = current.enabled && current.mode === enabled.mode ? current : enabled;
    });
  }

  async disableSite(hostname: string): Promise<void> {
    const current = await this.getSite(hostname);
    await this.setSite(hostname, { ...current, enabled: false });
  }

  async recordPromptDecline(hostname: string): Promise<void> {
    const current = await this.getSite(hostname);
    await this.setSite(hostname, recordPromptDeclinePure(current));
  }

  async updateSiteMode(hostname: string, mode: SiteSettings['mode']): Promise<void> {
    const current = await this.getSite(hostname);
    await this.setSite(hostname, { ...current, mode });
  }

  async isOnboardingCompleted(): Promise<boolean> {
    return (await this.getAuthoritativeState()).onboardingCompleted;
  }
  async markOnboardingCompleted(): Promise<void> {
    await this.updateAuthoritativeState((state) => { state.onboardingCompleted = true; });
  }

  async getGlobalPausedUntil(): Promise<number> { return (await this.getRuntimeState()).globalPausedUntil; }
  async setGlobalPausedUntil(globalPausedUntil: number): Promise<void> {
    const runtime = await this.getRuntimeState();
    await this.setRuntimeState({ ...runtime, globalPausedUntil });
  }

  async getAppSettings(): Promise<AppSettings> {
    return (await this.getAuthoritativeState()).appSettings;
  }
  async setAppSettings(appSettings: AppSettings): Promise<void> {
    await this.updateAuthoritativeState((state) => { state.appSettings = normalizeAppSettings(appSettings); });
  }
  async resetAppSettings(): Promise<void> { await this.setAppSettings({ ...DEFAULT_SETTINGS }); }

  async getCooldownConfig(): Promise<{ defaultCooldownMinutes: number; consecutiveSkipCooldowns: number[] }> {
    const app = await this.getAppSettings();
    return { defaultCooldownMinutes: app.defaultCooldownMinutes, consecutiveSkipCooldowns: app.consecutiveSkipCooldowns };
  }

  async listSites(): Promise<{ hostname: string; settings: SiteSettings }[]> {
    const state = await this.getAuthoritativeState();
    return Object.entries(state.sites).map(([hostname, settings]) => ({ hostname, settings }));
  }

  async removeSite(hostname: string): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      delete state.sites[canonicalSiteKey(hostname)];
    });
  }
}
