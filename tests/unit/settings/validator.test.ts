import { describe, expect, it } from 'vitest';
import {
  normalizeAppSettings,
  validateAppSettings,
  normalizeSiteSettings,
} from '@/settings/validator';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { AppSettings, SelfRatedLevel, SiteSettings } from '@/types';

describe('validateAppSettings — Issue #10 AC3 校验', () => {
  it('默认设置合法', () => {
    expect(validateAppSettings(DEFAULT_SETTINGS).valid).toBe(true);
  });

  it('defaultCooldownMinutes 非正数不合法', () => {
    const result = validateAppSettings({ ...DEFAULT_SETTINGS, defaultCooldownMinutes: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(';')).toMatch(/冷却/);
  });

  it('dailyNewWordLimit 超出 [0, 100] 不合法', () => {
    expect(
      validateAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: -1 }).valid,
    ).toBe(false);
    expect(
      validateAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 101 }).valid,
    ).toBe(false);
  });

  it('consecutiveSkipCooldowns 为空数组不合法', () => {
    expect(
      validateAppSettings({ ...DEFAULT_SETTINGS, consecutiveSkipCooldowns: [] }).valid,
    ).toBe(false);
  });

  it('consecutiveSkipCooldowns 含非正数不合法', () => {
    expect(
      validateAppSettings({
        ...DEFAULT_SETTINGS,
        consecutiveSkipCooldowns: [5, 0, 60],
      }).valid,
    ).toBe(false);
  });

  it('selectedDeckId 为空不合法', () => {
    expect(
      validateAppSettings({ ...DEFAULT_SETTINGS, selectedDeckId: '' }).valid,
    ).toBe(false);
  });

  it('selfRatedLevel 非法值不合法', () => {
    expect(
      validateAppSettings({
        ...DEFAULT_SETTINGS,
        selfRatedLevel: 'expert' as SelfRatedLevel,
      }).valid,
    ).toBe(false);
  });

  it('longVideoIntervalMinutes 开启时必须为正数', () => {
    expect(
      validateAppSettings({
        ...DEFAULT_SETTINGS,
        longVideoTimedLearningEnabled: true,
        longVideoIntervalMinutes: 0,
      }).valid,
    ).toBe(false);
  });
});

describe('normalizeAppSettings — Issue #10 AC3 自动修正', () => {
  it('合法输入原样返回', () => {
    const out = normalizeAppSettings(DEFAULT_SETTINGS);
    expect(out).toEqual(DEFAULT_SETTINGS);
  });

  it('defaultCooldownMinutes 非正数修正为默认值', () => {
    const out = normalizeAppSettings({ ...DEFAULT_SETTINGS, defaultCooldownMinutes: -5 });
    expect(out.defaultCooldownMinutes).toBe(DEFAULT_SETTINGS.defaultCooldownMinutes);
  });

  it('dailyNewWordLimit 超上限修正为上限', () => {
    const out = normalizeAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 999 });
    expect(out.dailyNewWordLimit).toBe(100);
  });

  it('dailyNewWordLimit 负数修正为 0', () => {
    const out = normalizeAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: -3 });
    expect(out.dailyNewWordLimit).toBe(0);
  });

  it('consecutiveSkipCooldowns 含非正数项被过滤，空则回退默认', () => {
    const out = normalizeAppSettings({
      ...DEFAULT_SETTINGS,
      consecutiveSkipCooldowns: [5, 0, 60],
    });
    expect(out.consecutiveSkipCooldowns).toEqual([5, 60]);

    const empty = normalizeAppSettings({
      ...DEFAULT_SETTINGS,
      consecutiveSkipCooldowns: [],
    });
    expect(empty.consecutiveSkipCooldowns).toEqual(DEFAULT_SETTINGS.consecutiveSkipCooldowns);
  });

  it('selectedDeckId 为空修正为默认词库', () => {
    const out = normalizeAppSettings({ ...DEFAULT_SETTINGS, selectedDeckId: '' });
    expect(out.selectedDeckId).toBe(DEFAULT_SETTINGS.selectedDeckId);
  });

  it('selfRatedLevel 非法值修正为默认', () => {
    const out = normalizeAppSettings({
      ...DEFAULT_SETTINGS,
      selfRatedLevel: 'expert' as SelfRatedLevel,
    });
    expect(out.selfRatedLevel).toBe(DEFAULT_SETTINGS.selfRatedLevel);
  });

  it('longVideoIntervalMinutes 非正数修正为默认值', () => {
    const out = normalizeAppSettings({
      ...DEFAULT_SETTINGS,
      longVideoIntervalMinutes: 0,
    });
    expect(out.longVideoIntervalMinutes).toBe(DEFAULT_SETTINGS.longVideoIntervalMinutes);
  });

  it('缺失字段补齐为默认值（部分输入）', () => {
    const partial = {
      defaultCooldownMinutes: 3,
      consecutiveSkipCooldowns: [1, 2],
      dailyNewWordLimit: 7,
    } as Partial<AppSettings>;
    const out = normalizeAppSettings(partial);
    expect(out.defaultCooldownMinutes).toBe(3);
    expect(out.consecutiveSkipCooldowns).toEqual([1, 2]);
    expect(out.dailyNewWordLimit).toBe(7);
    expect(out.selectedDeckId).toBe(DEFAULT_SETTINGS.selectedDeckId);
    expect(out.selfRatedLevel).toBe(DEFAULT_SETTINGS.selfRatedLevel);
    expect(out.spellingEnabled).toBe(DEFAULT_SETTINGS.spellingEnabled);
    expect(out.longVideoTimedLearningEnabled).toBe(
      DEFAULT_SETTINGS.longVideoTimedLearningEnabled,
    );
    expect(out.longVideoIntervalMinutes).toBe(DEFAULT_SETTINGS.longVideoIntervalMinutes);
  });
});

describe('normalizeSiteSettings — Issue #10 AC2 基础网页触发', () => {
  const base: SiteSettings = {
    enabled: true,
    mode: 'basic-web',
    firstQuestionPending: false,
  };

  it('basic-web 模式缺省 pageLoadTrigger/scrollTrigger 视为 true', () => {
    const out = normalizeSiteSettings(base);
    expect(out.pageLoadTrigger).toBe(true);
    expect(out.scrollTrigger).toBe(true);
  });

  it('保留用户显式设置的 false', () => {
    const out = normalizeSiteSettings({ ...base, pageLoadTrigger: false });
    expect(out.pageLoadTrigger).toBe(false);
    expect(out.scrollTrigger).toBe(true);
  });

  it('非 basic-web 模式不强制注入触发开关', () => {
    const full: SiteSettings = {
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    };
    const out = normalizeSiteSettings(full);
    expect(out.pageLoadTrigger).toBeUndefined();
    expect(out.scrollTrigger).toBeUndefined();
  });
});
