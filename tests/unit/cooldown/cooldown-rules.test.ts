import { describe, expect, it } from 'vitest';
import {
  applyComplete,
  applySkip,
  isReady,
  type CooldownConfig,
} from '@/cooldown/cooldown-rules';
import type { CooldownState } from '@/types';

const NOW = 1_000_000;
const MS_PER_MIN = 60_000;

const CONFIG: CooldownConfig = {
  defaultCooldownMinutes: 2,
  consecutiveSkipCooldowns: [5, 15, 60],
};

function state(nextAllowedAt: number, consecutiveSkipCount: number): CooldownState {
  return { nextAllowedAt, consecutiveSkipCount };
}

describe('cooldown rules', () => {
  describe('applyComplete — 正常完成题目', () => {
    it('设置默认冷却并清零连续跳过计数', () => {
      const after = applyComplete(NOW, CONFIG);

      // 期望：now + 2 分钟，跳过计数归零
      expect(after).toEqual({ nextAllowedAt: NOW + 2 * MS_PER_MIN, consecutiveSkipCount: 0 });
    });

    it('在已经清零的状态下完成仍设置默认冷却', () => {
      const after = applyComplete(NOW, CONFIG);

      expect(after.nextAllowedAt).toBe(NOW + 2 * MS_PER_MIN);
      expect(after.consecutiveSkipCount).toBe(0);
    });
  });

  describe('applySkip — 连续跳过自动降频', () => {
    it('第一次跳过进入 5 分钟冷却，计数为 1', () => {
      const after = applySkip(state(NOW, 0), NOW, CONFIG);

      expect(after).toEqual({ nextAllowedAt: NOW + 5 * MS_PER_MIN, consecutiveSkipCount: 1 });
    });

    it('第二次跳过进入 15 分钟冷却，计数为 2', () => {
      const after = applySkip(state(NOW, 1), NOW, CONFIG);

      expect(after).toEqual({ nextAllowedAt: NOW + 15 * MS_PER_MIN, consecutiveSkipCount: 2 });
    });

    it('第三次跳过进入 60 分钟冷却，计数为 3', () => {
      const after = applySkip(state(NOW, 2), NOW, CONFIG);

      expect(after).toEqual({ nextAllowedAt: NOW + 60 * MS_PER_MIN, consecutiveSkipCount: 3 });
    });

    it('第三次之后的跳过仍保持 60 分钟冷却，计数封顶为 3', () => {
      const after = applySkip(state(NOW, 3), NOW, CONFIG);

      expect(after).toEqual({ nextAllowedAt: NOW + 60 * MS_PER_MIN, consecutiveSkipCount: 3 });
    });

    it('多次跳过后正常完成会清零跳过计数', () => {
      applySkip(state(NOW, 2), NOW, CONFIG);
      const completed = applyComplete(NOW + 1, CONFIG);

      expect(completed.consecutiveSkipCount).toBe(0);
      expect(completed.nextAllowedAt).toBe(NOW + 1 + 2 * MS_PER_MIN);
    });
  });

  describe('isReady — 冷却是否已结束', () => {
    it('当前时间早于 nextAllowedAt 时不允许触发', () => {
      expect(isReady(state(NOW + 1000, 0), NOW)).toBe(false);
    });

    it('当前时间等于 nextAllowedAt 时允许触发', () => {
      expect(isReady(state(NOW, 0), NOW)).toBe(true);
    });

    it('当前时间晚于 nextAllowedAt 时允许触发', () => {
      expect(isReady(state(NOW - 1000, 0), NOW)).toBe(true);
    });
  });
});
