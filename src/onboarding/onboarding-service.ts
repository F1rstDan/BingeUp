import type { SiteSettings } from '@/types';

/**
 * 安装引导与有限启用提示纯逻辑（Issue #9 AC1 / AC2）。无副作用，不访问存储或浏览器 API。
 *
 * AC1：受支持站点默认启用；引导允许用户取消任意站点。
 * AC2：跳过引导后，Bilibili/YouTube 各自最多两次有限启用提示；启用后需刷新或新开页面才开始正式运行。
 */

/** 引导中可选、且默认启用的受支持站点。 */
const ONBOARDING_SITES = {
  bilibili: 'bilibili.com',
  youtube: 'youtube.com',
} as const;

export type OnboardingSiteSelection = keyof typeof ONBOARDING_SITES;
export const ONBOARDING_HOSTNAMES = Object.values(ONBOARDING_SITES);

/** 跳过引导后每个网站最多主动提示次数（AC2）。 */
export const MAX_PROMPT_DECLINES = 2;

/** 站点键 → 规范主机名。 */
export function canonicalHostnameFor(site: OnboardingSiteSelection): string {
  return ONBOARDING_SITES[site];
}

/** 根据用户选择的网站返回需要启用的规范主机名列表。 */
export function siteKeysToEnable(sites: OnboardingSiteSelection[]): string[] {
  return sites.map(canonicalHostnameFor);
}

/** 将消息中的站点限制为安装引导可控制的规范主机名。 */
export function selectedOnboardingHostnames(hostnames: readonly string[]): string[] {
  return ONBOARDING_HOSTNAMES.filter((hostname) => hostnames.includes(hostname));
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
