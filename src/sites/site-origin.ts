/** 自定义网站权限统一使用精确 HTTPS hostname，不隐式覆盖子域名。 */
export function exactHttpsOriginPattern(hostname: string): string {
  return `https://${hostname}/*`;
}
