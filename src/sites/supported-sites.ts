/** 当前具有完整视频学习适配的站点与内容脚本匹配规则。 */
export const SUPPORTED_CONTENT_SCRIPT_MATCHES = [
  '*://*.bilibili.com/*',
  '*://*.youtube.com/*',
] as const;

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isBilibiliHostname(hostname: string): boolean {
  return isHostOrSubdomain(hostname, 'bilibili.com');
}

export function isYouTubeHostname(hostname: string): boolean {
  return hostname !== 'music.youtube.com' && isHostOrSubdomain(hostname, 'youtube.com');
}

export function isSupportedHostname(hostname: string): boolean {
  return isBilibiliHostname(hostname) || isYouTubeHostname(hostname);
}
