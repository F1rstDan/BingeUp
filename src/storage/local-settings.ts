import type { AppSettings, CooldownState, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { normalizeAppSettings, normalizeSiteSettings as normalizeSiteSettingsPure } from '@/settings/validator';
import {
  isBilibiliHostname,
  isSupportedHostname,
  isYouTubeHostname,
} from '@/sites/supported-sites';
import { recordPromptDecline as recordPromptDeclinePure } from '@/onboarding/onboarding-service';

const STORAGE_KEY = 'bingeup:state';

/**
 * 持久化状态结构（Issue #10 起导出，供数据导出/导入使用）。
 */
export interface PersistedState {
  cooldown: CooldownState;
  sites: Record<string, SiteSettings>;
  /** 引导是否已完成（Issue #9）。 */
  onboardingCompleted: boolean;
  /** 全局暂停到期时间戳（ms）；0 表示未暂停（Issue #9 AC4）。 */
  globalPausedUntil: number;
  /** 应用设置（Issue #10）。缺省时回退默认。 */
  appSettings?: AppSettings;
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
 * 受支持站点的默认设置：安装后即启用，并等待首次触发。
 * 用户显式暂停时，持久化设置会覆盖此默认值。
 *
 * 自定义站点（Issue #11）：非 Bilibili/YouTube 的主机名默认 unsupported，
 * 等待用户从 Popup 主动加入后由能力检测写入 generic-video / basic-web。
 */
function defaultSiteSettings(hostname: string): SiteSettings {
  if (!isSupportedHostname(hostname)) return unsupportedSiteSettings();
  return { enabled: true, mode: 'full-adaptation', firstQuestionPending: true };
}

/**
 * 规范持久化的站点设置（Issue #9 / #10 / #11）。
 *
 * - 官方站点（Bilibili/YouTube）：应用设置校验器规范，模式锁定为 full-adaptation；
 * - 自定义站点（Issue #11）：允许 generic-video / basic-web / unsupported 模式，
 *   但不允许 full-adaptation（专属适配器保留给官方站点）；
 * - 未受支持站点：强制为 unsupported。
 */
function normalizeSiteSettings(hostname: string, settings: SiteSettings): SiteSettings {
  if (isSupportedHostname(hostname)) {
    return normalizeSiteSettingsPure(settings);
  }
  // 自定义站点：full-adaptation 降级为 generic-video（保护官方适配器边界）。
  if (settings.mode === 'full-adaptation') {
    return normalizeSiteSettingsPure({ ...settings, mode: 'generic-video' });
  }
  return normalizeSiteSettingsPure(settings);
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
      appSettings: stored.appSettings ? normalizeAppSettings(stored.appSettings) : undefined,
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

  /**
   * 启用一个站点：首次启用进入首次触发待处理状态；重复启用相同模式保持现有状态，
   * 同时将受支持站点的虚拟默认值物化到持久化列表。
   */
  async enableSite(hostname: string, mode: SiteSettings['mode'] = 'full-adaptation'): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const current = normalizeSiteSettings(
      hostname,
      state.sites[key] ?? defaultSiteSettings(hostname),
    );
    const newlyEnabled = normalizeSiteSettings(hostname, {
      enabled: true,
      mode,
      firstQuestionPending: true,
    });
    state.sites[key] = current.enabled && current.mode === newlyEnabled.mode
      ? current
      : newlyEnabled;
    await this.write(state);
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

  /**
   * 更新站点兼容模式（Issue #11 AC4）。
   * 用于内容脚本在页面加载时重新检测能力并更新持久化模式。
   * 保留 enabled / firstQuestionPending / 触发开关等现有字段。
   */
  async updateSiteMode(hostname: string, mode: SiteSettings['mode']): Promise<void> {
    const state = await this.read();
    const key = canonicalSiteKey(hostname);
    const current = state.sites[key] ?? defaultSiteSettings(hostname);
    state.sites[key] = normalizeSiteSettings(hostname, { ...current, mode });
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

  // ─── Issue #10：应用设置与站点管理 ───────────────────────

  /** 读取应用设置；缺省回退默认并自动修正。 */
  async getAppSettings(): Promise<AppSettings> {
    const state = await this.read();
    return state.appSettings ?? { ...DEFAULT_SETTINGS };
  }

  /** 保存应用设置（先自动修正再持久化，AC3）。 */
  async setAppSettings(settings: AppSettings): Promise<void> {
    const state = await this.read();
    state.appSettings = normalizeAppSettings(settings);
    await this.write(state);
  }

  /** 恢复默认应用设置。 */
  async resetAppSettings(): Promise<void> {
    const state = await this.read();
    state.appSettings = { ...DEFAULT_SETTINGS };
    await this.write(state);
  }

  /**
   * 读取冷却配置（AC3 实时生效）：从持久化的应用设置派生，
   * 而非启动时缓存的默认值。background 每次处理冷却消息时调用。
   */
  async getCooldownConfig(): Promise<{
    defaultCooldownMinutes: number;
    consecutiveSkipCooldowns: number[];
  }> {
    const app = await this.getAppSettings();
    return {
      defaultCooldownMinutes: app.defaultCooldownMinutes,
      consecutiveSkipCooldowns: app.consecutiveSkipCooldowns,
    };
  }

  /** 列出所有已持久化的站点设置（AC2 站点管理）。 */
  async listSites(): Promise<{ hostname: string; settings: SiteSettings }[]> {
    const state = await this.read();
    return Object.entries(state.sites).map(([hostname, settings]) => ({
      hostname,
      settings,
    }));
  }

  /** 删除站点设置（AC5：删除自定义网站时由路由层释放可选权限）。 */
  async removeSite(hostname: string): Promise<void> {
    const key = canonicalSiteKey(hostname);
    const state = await this.read();
    if (!(key in state.sites)) return;
    delete state.sites[key];
    await this.write(state);
  }
}
