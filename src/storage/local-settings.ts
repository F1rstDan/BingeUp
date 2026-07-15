import type { AppSettings, CooldownState, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import {
  normalizeAppSettings,
  normalizeSiteSettings as normalizeSiteSettingsPure,
} from '@/settings/validator';
import {
  isBilibiliHostname,
  isSupportedHostname,
  isYouTubeHostname,
} from '@/sites/supported-sites';
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
interface PlaybackRecoveryNoticeState {
  localDate: string;
  count: number;
}

export interface RuntimeState {
  cooldown: CooldownState;
  globalPausedUntil: number;
  playbackRecoveryNotice: PlaybackRecoveryNoticeState;
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
  playbackRecoveryNotice: { localDate: '', count: 0 },
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
    sites: Object.fromEntries(
      Object.entries(state.sites).map(([hostname, settings]) => [
        hostname,
        normalizeSiteSettings(hostname, settings),
      ]),
    ),
    onboardingCompleted: state.onboardingCompleted,
  };
}

export class LocalSettingsStore {
  constructor(readonly database: IDBDatabase) {}

  /**
   * 运行时状态（冷却 + 全局暂停）的串行化锁（Issue #19 AC6/AC7）。
   *
   * chrome.storage.local 没有事务，`setCooldown` / `setGlobalPausedUntil` /
   * 冷却规则应用都采用"读取 → 修改 → 写回"模式。多个并发消息（多标签完成/跳过题目）
   * 同时执行该模式会丢失更新（后写覆盖前写）。
   *
   * 所有运行时状态的读-改-写都通过本锁串行化。由于全部冷却/暂停消息都在
   * background service worker 的同一 `LocalSettingsStore` 实例上处理，
   * 锁的获取顺序即消息到达顺序，保证完成与跳过并发时最终状态有确定、可测试的顺序语义。
   */
  private runtimeLock: Promise<void> = Promise.resolve();

  private withRuntimeLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.runtimeLock.then(fn);
    // 无论 fn 成功或失败，都释放锁：失败时记录但不阻塞后续调用。
    this.runtimeLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * 在运行时锁内原子地读取-修改-写回运行时状态（Issue #19 AC6/AC7）。
   * 返回写回后的完整运行时状态，供调用方读取变更后的字段。
   */
  private async updateRuntimeState(
    mutate: (state: RuntimeState) => RuntimeState,
  ): Promise<RuntimeState> {
    return this.withRuntimeLock(async () => {
      const current = await this.getRuntimeState();
      const next = mutate(current);
      await this.setRuntimeState(next);
      return next;
    });
  }

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
    return stored
      ? copyAuthoritativeState(stored)
      : copyAuthoritativeState(DEFAULT_AUTHORITATIVE_STATE);
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
      playbackRecoveryNotice: {
        ...DEFAULT_RUNTIME_STATE.playbackRecoveryNotice,
        ...stored?.playbackRecoveryNotice,
      },
    };
  }

  async setRuntimeState(state: RuntimeState): Promise<void> {
    await chrome.storage.local.set({ [RUNTIME_STORAGE_KEY]: state });
  }

  async resetRuntimeState(): Promise<void> {
    await this.setRuntimeState({
      cooldown: { ...DEFAULT_RUNTIME_STATE.cooldown },
      globalPausedUntil: DEFAULT_RUNTIME_STATE.globalPausedUntil,
      playbackRecoveryNotice: { ...DEFAULT_RUNTIME_STATE.playbackRecoveryNotice },
    });
  }

  async read(): Promise<PersistedState> {
    const [authoritative, runtime] = await Promise.all([
      this.getAuthoritativeState(),
      this.getRuntimeState(),
    ]);
    return { ...authoritative, ...runtime };
  }

  async getCooldown(): Promise<CooldownState> {
    return (await this.getRuntimeState()).cooldown;
  }
  async setCooldown(cooldown: CooldownState): Promise<void> {
    // Issue #19 AC6：通过运行时锁串行化，避免与并发冷却更新/暂停写入丢失更新。
    await this.updateRuntimeState((state) => ({ ...state, cooldown }));
  }

  async claimPlaybackRecoveryNotice(now: number): Promise<boolean> {
    let claimed = false;
    await this.updateRuntimeState((state) => {
      const date = new Date(now);
      const localDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      const current = state.playbackRecoveryNotice;
      const count = current.localDate === localDate ? current.count : 0;
      if (count >= 3) return state;
      claimed = true;
      return {
        ...state,
        playbackRecoveryNotice: { localDate, count: count + 1 },
      };
    });
    return claimed;
  }

  /**
   * 原子地更新冷却状态：在运行时锁内读取当前冷却、应用变更函数、写回（Issue #19 AC6/AC7）。
   *
   * 冷却规则（applyComplete / applySkip）依赖"前一次状态"做读-改-写；
   * 本方法保证多标签并发完成/跳过时变更按消息到达顺序串行化，
   * 不会因并发读-改-写丢失连续跳过计数或完成重置。
   *
   * @param mutate 接收当前冷却状态、返回下一状态。`now` 应在函数内捕获，
   *   以反映锁内实际应用时刻。
   * @returns 写回后的冷却状态。
   */
  async updateCooldown(mutate: (before: CooldownState) => CooldownState): Promise<CooldownState> {
    const next = await this.updateRuntimeState((state) => ({
      ...state,
      cooldown: mutate(state.cooldown),
    }));
    return next.cooldown;
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
      const site = normalizeSiteSettings(
        hostname,
        state.sites[key] ?? defaultSiteSettings(hostname),
      );
      if (site.firstQuestionPending) state.sites[key] = { ...site, firstQuestionPending: false };
    });
  }

  async enableSite(
    hostname: string,
    mode: SiteSettings['mode'] = 'full-adaptation',
  ): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      const key = canonicalSiteKey(hostname);
      const current = normalizeSiteSettings(
        hostname,
        state.sites[key] ?? defaultSiteSettings(hostname),
      );
      const enabled = normalizeSiteSettings(hostname, {
        enabled: true,
        mode,
        firstQuestionPending: true,
      });
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

  async updateSiteTriggers(
    hostname: string,
    triggers: Pick<SiteSettings, 'pageLoadTrigger' | 'scrollTrigger'>,
  ): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      const key = canonicalSiteKey(hostname);
      const current = normalizeSiteSettings(
        hostname,
        state.sites[key] ?? defaultSiteSettings(hostname),
      );
      if (current.mode !== 'basic-web') {
        throw new Error('只有基础网页模式可以修改页面触发设置');
      }
      state.sites[key] = normalizeSiteSettings(hostname, { ...current, ...triggers });
    });
  }

  async isOnboardingCompleted(): Promise<boolean> {
    return (await this.getAuthoritativeState()).onboardingCompleted;
  }
  async markOnboardingCompleted(): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      state.onboardingCompleted = true;
    });
  }

  async getGlobalPausedUntil(): Promise<number> {
    return (await this.getRuntimeState()).globalPausedUntil;
  }
  async setGlobalPausedUntil(globalPausedUntil: number): Promise<void> {
    // Issue #19 AC6：与冷却更新共用运行时锁，避免并发写回时互相覆盖。
    await this.updateRuntimeState((state) => ({ ...state, globalPausedUntil }));
  }

  async getAppSettings(): Promise<AppSettings> {
    return (await this.getAuthoritativeState()).appSettings;
  }
  async setAppSettings(appSettings: AppSettings): Promise<void> {
    await this.updateAuthoritativeState((state) => {
      state.appSettings = normalizeAppSettings(appSettings);
    });
  }
  async resetAppSettings(): Promise<void> {
    await this.setAppSettings({ ...DEFAULT_SETTINGS });
  }

  async getCooldownConfig(): Promise<{
    defaultCooldownMinutes: number;
    consecutiveSkipCooldowns: number[];
  }> {
    const app = await this.getAppSettings();
    return {
      defaultCooldownMinutes: app.defaultCooldownMinutes,
      consecutiveSkipCooldowns: app.consecutiveSkipSlowdownEnabled
        ? app.consecutiveSkipCooldowns
        : [],
    };
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
