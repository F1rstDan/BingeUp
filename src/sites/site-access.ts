import { messageClient } from '@/messaging/message-client';
import { isSupportedHostname } from '@/sites/supported-sites';
import { exactHttpsOriginPattern } from '@/sites/site-origin';

export type AddWebsiteResult =
  | {
      ok: true;
      hostname: string;
      status: 'added' | 'already-enabled' | 'permission-restored';
    }
  | { ok: false; message: string };

function normalizeWebsiteInput(input: string): { hostname: string } | { message: string } {
  const value = input.trim();
  if (!value) return { message: '请输入网站地址。' };

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:') {
      return { message: '仅支持普通 HTTPS 网站。' };
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) return { message: '请输入有效的网站地址。' };
    return { hostname };
  } catch {
    return { message: '请输入有效的网站地址。' };
  }
}

/** 设置页与插件面板共用的网站加入边界（Issue #16）。 */
export async function addWebsite(input: string): Promise<AddWebsiteResult> {
  const normalized = normalizeWebsiteInput(input);
  if ('message' in normalized) return { ok: false, message: normalized.message };

  const { hostname } = normalized;
  let alreadyEnabled = false;

  try {
    const current = await messageClient.getSiteState(hostname);
    if (isSupportedHostname(hostname)) {
      const status =
        current.enabled && current.mode !== 'unsupported' ? 'already-enabled' : 'added';
      // 默认启用的专属站点可能尚无持久化记录；幂等启用会物化它，供设置页列出。
      await messageClient.enableSite(hostname);
      return { ok: true, hostname, status };
    }
    alreadyEnabled = current.enabled && current.mode !== 'unsupported';
  } catch (error) {
    return {
      ok: false,
      message: `加入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const origins = [exactHttpsOriginPattern(hostname)];
  let alreadyGranted = false;
  let grantedByThisCall = false;

  try {
    alreadyGranted = await chrome.permissions.contains({ origins });
    if (alreadyEnabled && alreadyGranted) {
      return { ok: true, hostname, status: 'already-enabled' };
    }
    let granted = alreadyGranted;
    if (!alreadyGranted) {
      granted = await chrome.permissions.request({ origins });
      grantedByThisCall = granted;
    }
    if (!granted) {
      return { ok: false, message: '未授予访问权限，无法加入该网站。' };
    }

    if (alreadyEnabled) {
      await messageClient.addCustomSite(hostname);
      return { ok: true, hostname, status: 'permission-restored' };
    }
    await messageClient.addCustomSite(hostname);
    return { ok: true, hostname, status: 'added' };
  } catch (error) {
    if (grantedByThisCall) {
      try {
        await chrome.permissions.remove({ origins });
      } catch {
        // 回滚失败不覆盖原始错误；界面仍不会把网站显示为已启用。
      }
    }
    return {
      ok: false,
      message: `加入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
