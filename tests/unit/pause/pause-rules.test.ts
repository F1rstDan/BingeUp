import { describe, expect, it } from 'vitest';
import {
  pauseAll,
  pauseToday,
  resumeAll,
  isGloballyPaused,
  endOfToday,
} from '@/pause/pause-rules';

const NOW = new Date('2026-07-11T10:30:00.000Z').getTime();

describe('pause-rules — 暂停全部', () => {
  it('暂停全部返回一个远期时间戳，判定为已暂停', () => {
    const until = pauseAll(NOW);
    expect(until).toBeGreaterThan(NOW);
    expect(isGloballyPaused(until, NOW)).toBe(true);
  });

  it('恢复全部返回 0，判定为未暂停', () => {
    const until = resumeAll();
    expect(until).toBe(0);
    expect(isGloballyPaused(until, NOW)).toBe(false);
  });
});

describe('pause-rules — 暂停今天', () => {
  it('暂停今天返回本地自然日结束时间戳', () => {
    const until = pauseToday(NOW);
    expect(until).toBeGreaterThan(NOW);
    expect(isGloballyPaused(until, NOW)).toBe(true);
  });

  it('同一天内判定仍为已暂停', () => {
    const until = pauseToday(NOW);
    const laterSameDay = NOW + 60_000;
    expect(isGloballyPaused(until, laterSameDay)).toBe(true);
  });

  it('次日同一时刻判定为未暂停', () => {
    const until = pauseToday(NOW);
    const nextDay = NOW + 24 * 60 * 60 * 1000;
    expect(isGloballyPaused(until, nextDay)).toBe(false);
  });
});

describe('pause-rules — endOfToday', () => {
  it('返回当日 23:59:59.999 的本地时间戳', () => {
    const end = endOfToday(NOW);
    const d = new Date(end);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
    // 与输入同一日
    expect(d.toDateString()).toBe(new Date(NOW).toDateString());
  });
});

describe('pause-rules — isGloballyPaused 边界', () => {
  it('pausedUntil=0 永远未暂停', () => {
    expect(isGloballyPaused(0, NOW)).toBe(false);
  });

  it('now === pausedUntil 视为已恢复（开区间右端）', () => {
    expect(isGloballyPaused(NOW, NOW)).toBe(false);
  });

  it('now < pausedUntil 视为已暂停', () => {
    expect(isGloballyPaused(NOW + 1, NOW)).toBe(true);
  });
});
