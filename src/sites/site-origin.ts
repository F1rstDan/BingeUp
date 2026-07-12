/** 自定义网站权限统一使用精确 HTTPS hostname，不隐式覆盖子域名。 */
export function exactHttpsOriginPattern(hostname: string): string {
  return `https://${hostname}/*`;
}

/** Issue #16 之前自定义站点曾申请的宽泛权限，仅用于删除时迁移清理。 */
export function legacyBroadOriginPatterns(hostname: string): string[] {
  return [`*://${hostname}/*`, `*://*.${hostname}/*`];
}
