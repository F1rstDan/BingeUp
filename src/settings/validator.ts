import type { AppSettings, SelfRatedLevel, SiteSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

/**
 * 设置校验与自动修正（Issue #10 AC3）。
 *
 * 纯函数，无副作用。校验返回错误列表；自动修正保证输出始终是合法的 AppSettings。
 * 保存路径先校验再自动修正，使非法输入不会污染持久化状态。
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 每日新词上限取值范围。 */
const MIN_DAILY_NEW_WORD_LIMIT = 0;
const MAX_DAILY_NEW_WORD_LIMIT = 100;

const VALID_LEVELS: readonly SelfRatedLevel[] = ['beginner', 'intermediate', 'advanced'];

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * 校验应用设置（Issue #10 AC3）。返回错误列表；空列表表示合法。
 */
export function validateAppSettings(input: Partial<AppSettings>): ValidationResult {
  const errors: string[] = [];

  if (!isFinitePositive(input.defaultCooldownMinutes)) {
    errors.push('默认冷却分钟数必须为正数');
  }
  if (
    !isFiniteNonNegative(input.dailyNewWordLimit) ||
    input.dailyNewWordLimit > MAX_DAILY_NEW_WORD_LIMIT
  ) {
    errors.push(`每日新词上限必须在 ${MIN_DAILY_NEW_WORD_LIMIT}-${MAX_DAILY_NEW_WORD_LIMIT} 之间`);
  }
  if (!Array.isArray(input.consecutiveSkipCooldowns) || input.consecutiveSkipCooldowns.length === 0) {
    errors.push('连续跳过降频冷却不能为空');
  } else if (!input.consecutiveSkipCooldowns.every((m) => isFinitePositive(m))) {
    errors.push('连续跳过降频冷却必须为正数');
  }
  if (typeof input.selectedDeckId !== 'string' || input.selectedDeckId.trim() === '') {
    errors.push('当前词库不能为空');
  }
  if (typeof input.selfRatedLevel !== 'string' || !VALID_LEVELS.includes(input.selfRatedLevel as SelfRatedLevel)) {
    errors.push('自评水平取值非法');
  }
  if (typeof input.spellingEnabled !== 'boolean') {
    errors.push('拼写题开关必须为布尔值');
  }
  if (typeof input.longVideoTimedLearningEnabled !== 'boolean') {
    errors.push('长视频定时学习开关必须为布尔值');
  }
  if (!isFinitePositive(input.longVideoIntervalMinutes)) {
    errors.push('长视频定时学习间隔必须为正数');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 自动修正应用设置（Issue #10 AC3）。
 *
 * 非法或缺失字段回退到默认值；连续跳过降频过滤掉非正数项，过滤后为空则回退默认。
 * 输出始终是合法的 AppSettings。
 */
export function normalizeAppSettings(input: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(input as AppSettings) };

  if (!isFinitePositive(merged.defaultCooldownMinutes)) {
    merged.defaultCooldownMinutes = DEFAULT_SETTINGS.defaultCooldownMinutes;
  }
  // 每日新词上限：非数回退默认；负数修正为 0；超上限修正为上限。
  if (typeof merged.dailyNewWordLimit !== 'number' || !Number.isFinite(merged.dailyNewWordLimit)) {
    merged.dailyNewWordLimit = DEFAULT_SETTINGS.dailyNewWordLimit;
  } else if (merged.dailyNewWordLimit < MIN_DAILY_NEW_WORD_LIMIT) {
    merged.dailyNewWordLimit = MIN_DAILY_NEW_WORD_LIMIT;
  } else if (merged.dailyNewWordLimit > MAX_DAILY_NEW_WORD_LIMIT) {
    merged.dailyNewWordLimit = MAX_DAILY_NEW_WORD_LIMIT;
  }
  if (Array.isArray(merged.consecutiveSkipCooldowns)) {
    const filtered = merged.consecutiveSkipCooldowns.filter(isFinitePositive);
    merged.consecutiveSkipCooldowns =
      filtered.length > 0 ? filtered : [...DEFAULT_SETTINGS.consecutiveSkipCooldowns];
  } else {
    merged.consecutiveSkipCooldowns = [...DEFAULT_SETTINGS.consecutiveSkipCooldowns];
  }
  if (typeof merged.selectedDeckId !== 'string' || merged.selectedDeckId.trim() === '') {
    merged.selectedDeckId = DEFAULT_SETTINGS.selectedDeckId;
  }
  if (!VALID_LEVELS.includes(merged.selfRatedLevel)) {
    merged.selfRatedLevel = DEFAULT_SETTINGS.selfRatedLevel;
  }
  if (typeof merged.spellingEnabled !== 'boolean') {
    merged.spellingEnabled = DEFAULT_SETTINGS.spellingEnabled;
  }
  if (typeof merged.longVideoTimedLearningEnabled !== 'boolean') {
    merged.longVideoTimedLearningEnabled = DEFAULT_SETTINGS.longVideoTimedLearningEnabled;
  }
  if (!isFinitePositive(merged.longVideoIntervalMinutes)) {
    merged.longVideoIntervalMinutes = DEFAULT_SETTINGS.longVideoIntervalMinutes;
  }

  return merged;
}

/**
 * 规范站点设置（Issue #10 AC2）。
 *
 * 基础网页模式下，缺省的 pageLoadTrigger/scrollTrigger 视为 true；
 * 非基础网页模式不强制注入触发开关。
 */
export function normalizeSiteSettings(site: SiteSettings): SiteSettings {
  const out: SiteSettings = { ...site };
  if (out.mode === 'basic-web') {
    if (out.pageLoadTrigger === undefined) out.pageLoadTrigger = true;
    if (out.scrollTrigger === undefined) out.scrollTrigger = true;
  } else {
    out.pageLoadTrigger = undefined;
    out.scrollTrigger = undefined;
  }
  return out;
}
