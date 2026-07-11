import type { SiteSettings } from '@/types';

/**
 * 安装引导与有限启用提示纯逻辑（Issue #9 AC1 / AC2）。无副作用，不访问存储或浏览器 API。
 *
 * AC1：引导允许用户不选择任何网站完成，且仅在用户选择后请求对应网站权限。
 * AC2：跳过引导后，Bilibili/YouTube 各自最多两次有限启用提示；启用后需刷新或新开页面才开始正式运行。
 */

/** 引导中用户可选的网站（与具体浏览器权限解耦的站点键）。 */
export type OnboardingSiteSelection = 'bilibili' | 'youtube';

/** 跳过引导后每个网站最多主动提示次数（AC2）。 */
export const MAX_PROMPT_DECLINES = 2;

/** 站点键 → 内容脚本匹配模式（用于 chrome.permissions.request 的 origins）。 */
const SITE_ORIGIN_PATTERNS: Record<OnboardingSiteSelection, string> = {
  bilibili: '*://*.bilibili.com/*',
  youtube: '*://*.youtube.com/*',
};

/** 站点键 → 规范主机名（用于 LocalSettingsStore 的 canonical key）。 */
const SITE_CANONICAL_HOST: Record<OnboardingSiteSelection, string> = {
  bilibili: 'bilibili.com',
  youtube: 'youtube.com',
};

/** 根据用户选择的网站返回需要请求的 origin 匹配模式列表。空选择返回空列表（AC1）。 */
export function permissionOriginsFor(sites: OnboardingSiteSelection[]): string[] {
  return sites.map((s) => SITE_ORIGIN_PATTERNS[s]);
}

/** 站点键 → 规范主机名。 */
export function canonicalHostnameFor(site: OnboardingSiteSelection): string {
  return SITE_CANONICAL_HOST[site];
}

/** 根据用户选择的网站返回需要启用的规范主机名列表。 */
export function siteKeysToEnable(sites: OnboardingSiteSelection[]): string[] {
  return sites.map((s) => SITE_CANONICAL_HOST[s]);
}

/**
 * 判定是否应在当前支持网站上显示有限启用提示（AC2）。
 * 条件：引导已完成 && 站点未启用 && 拒绝次数未达上限。
 */
export function shouldShowEnablePrompt(site: SiteSettings, onboardingCompleted: boolean): boolean {
  if (!onboardingCompleted) return false;
  if (site.enabled) return false;
  return (site.promptDeclineCount ?? 0) < MAX_PROMPT_DECLINES;
}

/** 记录一次启用提示拒绝，返回新的站点设置（不可变）。 */
export function recordPromptDecline(site: SiteSettings): SiteSettings {
  return {
    ...site,
    promptDeclineCount: (site.promptDeclineCount ?? 0) + 1,
  };
}
