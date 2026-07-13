import { exactHttpsOriginPattern } from '@/sites/site-origin';
import { isSupportedHostname } from '@/sites/supported-sites';
import type { SiteSettings } from '@/types';

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';
const CUSTOM_SCRIPT_ID_PREFIX = 'bingeup_custom_';

export function customContentScriptId(hostname: string): string {
  const encodedHostname = btoa(hostname)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `${CUSTOM_SCRIPT_ID_PREFIX}${encodedHostname}`;
}

export async function registerCustomContentScript(hostname: string): Promise<void> {
  const script: chrome.scripting.RegisteredContentScript = {
    id: customContentScriptId(hostname),
    matches: [exactHttpsOriginPattern(hostname)],
    js: [CONTENT_SCRIPT_FILE],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [script.id] });
  if (registered.length === 0) {
    await chrome.scripting.registerContentScripts([script]);
    return;
  }
  await chrome.scripting.updateContentScripts([script]);
}

export async function unregisterCustomContentScript(hostname: string): Promise<void> {
  const id = customContentScriptId(hostname);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (registered.length === 0) return;
  await chrome.scripting.unregisterContentScripts({
    ids: [id],
  });
}

export async function syncCustomContentScripts(
  sites: { hostname: string; settings: SiteSettings }[],
): Promise<void> {
  const desiredHostnames: string[] = [];
  for (const { hostname, settings } of sites) {
    if (!settings.enabled || isSupportedHostname(hostname)) continue;
    const permitted = await chrome.permissions.contains({
      origins: [exactHttpsOriginPattern(hostname)],
    });
    if (permitted) desiredHostnames.push(hostname);
  }

  const desiredIds = new Set(desiredHostnames.map(customContentScriptId));
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const staleIds = registered
    .map(({ id }) => id)
    .filter((id) => id.startsWith(CUSTOM_SCRIPT_ID_PREFIX) && !desiredIds.has(id));
  if (staleIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: staleIds });
  }
  for (const hostname of desiredHostnames) {
    await registerCustomContentScript(hostname);
  }
}
