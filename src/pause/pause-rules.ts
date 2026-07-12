/**
 * 全局暂停规则（Issue #9）。纯函数，无副作用。
 *
 * 暂停语义：
 * - 暂停当前网站：在 LocalSettingsStore 中将该站点 `enabled` 置为 false，由用户在 Popup 重新开启；
 * - 暂停全部网站：`globalPausedUntil` 设为远期时间戳，由用户在 Popup 恢复；
 * - 暂停今天：`globalPausedUntil` 设为本地自然日结束时间戳，次日自动恢复。
 *
 * 判定使用开区间右端：`now < pausedUntil` 视为已暂停，`now === pausedUntil` 视为已恢复。
 */

/** 十分钟暂停的持续时间。 */
export const PAUSE_TEN_MINUTES_MS = 10 * 60 * 1000;

/** 暂停全部网站：返回远期时间戳（约 100 年后），等同于无限期暂停。 */
export function pauseAll(now: number): number {
  // Number.MAX_SAFE_INTEGER 会让 Date 构造失败，使用 100 年后的时间戳更稳妥。
  return now + 100 * 365 * 24 * 60 * 60 * 1000;
}

/** 暂停 10 分钟：返回十分钟后的时间戳，供 Popup 显示倒计时。 */
export function pauseForTenMinutes(now: number): number {
  return now + PAUSE_TEN_MINUTES_MS;
}

/** 恢复全部网站：返回 0，表示未暂停。 */
export function resumeAll(): number {
  return 0;
}

/** 暂停今天：返回本地自然日 23:59:59.999 的时间戳。 */
export function pauseToday(now: number): number {
  return endOfToday(now);
}

/** 计算本地自然日结束时间戳（当日 23:59:59.999）。 */
export function endOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 判定全局是否处于暂停状态。`now < pausedUntil` 视为已暂停。 */
export function isGloballyPaused(pausedUntil: number, now: number): boolean {
  if (pausedUntil <= 0) return false;
  return now < pausedUntil;
}
