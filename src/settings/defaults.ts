import type { AppSettings } from '@/types';
import { getDefaultDeck } from '@/dictionary/built-in/decks';

/**
 * 默认设置只有一个来源（M1-03 / Issue #10 完整设置模型）。
 *
 * 字段对应执行计划书第十七节"设置页"：
 * - 学习设置：当前词库、自评水平、每日新词上限、拼写题开关；
 * - 触发设置：默认冷却、长视频定时学习与间隔、连续跳过降频。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  defaultCooldownMinutes: 2,
  consecutiveSkipCooldowns: [5, 15, 60],
  /** 每日新词上限默认五个、不结转（Issue #6 验收标准 4）。 */
  dailyNewWordLimit: 5,
  /** 默认词库为首个内置词库。 */
  selectedDeckId: getDefaultDeck().id,
  /** 默认自评水平：一般。 */
  selfRatedLevel: 'intermediate',
  /** 拼写题默认开启（仅连续学习模式出现）。 */
  spellingEnabled: true,
  /** 长视频定时学习默认关闭（CONTEXT.md：用户主动开启后才在长视频中插题）。 */
  longVideoTimedLearningEnabled: false,
  /** 长视频定时学习间隔默认 10 分钟。 */
  longVideoIntervalMinutes: 10,
};
