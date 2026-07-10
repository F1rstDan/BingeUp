import type { CooldownState } from '@/types';

/** 冷却计算所需的配置（来自 AppSettings 的子集）。 */
export interface CooldownConfig {
  defaultCooldownMinutes: number;
  /** 连续跳过降频冷却分钟数，例如 [5, 15, 60]。 */
  consecutiveSkipCooldowns: number[];
}

const MS_PER_MIN = 60_000;

/**
 * 正常完成题目：恢复默认冷却，清零连续跳过计数。
 * 完成题目不依赖之前的跳过状态，故无需 before。
 */
export function applyComplete(now: number, config: CooldownConfig): CooldownState {
  return {
    nextAllowedAt: now + config.defaultCooldownMinutes * MS_PER_MIN,
    consecutiveSkipCount: 0,
  };
}

/**
 * 跳过：按连续跳过次数进入递增冷却。第三次及之后封顶为最后一档。
 */
export function applySkip(
  before: CooldownState,
  now: number,
  config: CooldownConfig,
): CooldownState {
  const nextCount = before.consecutiveSkipCount + 1;
  const tiers = config.consecutiveSkipCooldowns;
  // 索引封顶在最后一档：第 1/2/3 次跳过对应 tiers[0/1/2]，之后也用 tiers[2]。
  const tierIndex = Math.min(nextCount - 1, tiers.length - 1);
  const minutes = tiers[tierIndex] ?? config.defaultCooldownMinutes;
  return {
    nextAllowedAt: now + minutes * MS_PER_MIN,
    consecutiveSkipCount: Math.min(nextCount, tiers.length),
  };
}

/**
 * 全局冷却是否已经结束，插件可以在下一个自然触发点打开学习界面。
 */
export function isReady(state: CooldownState, now: number): boolean {
  return now >= state.nextAllowedAt;
}
