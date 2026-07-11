import type { AppSettings } from '@/types';

/** 默认设置只有一个来源（M1-03）。第一条纵向切片只含冷却相关字段。 */
export const DEFAULT_SETTINGS: AppSettings = {
  defaultCooldownMinutes: 2,
  consecutiveSkipCooldowns: [5, 15, 60],
  /** 每日新词上限默认五个、不结转（Issue #6 验收标准 4）。 */
  dailyNewWordLimit: 5,
};
