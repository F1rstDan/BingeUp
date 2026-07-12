import { exactHttpsOriginPattern } from '@/sites/site-origin';

/** 查询当前 hostname 的精确 HTTPS 权限；API 不可用时沿用既有 fail-open 展示策略。 */
export async function hasExactHttpsPermission(hostname: string): Promise<boolean> {
  if (!hostname) return false;
  try {
    return await chrome.permissions.contains({
      origins: [exactHttpsOriginPattern(hostname)],
    });
  } catch {
    return true;
  }
}
