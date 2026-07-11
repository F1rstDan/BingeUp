import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageObservationScheduler } from '@/adapters/observation';

const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

afterEach(() => {
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
});

describe('createPageObservationScheduler — Issue #13', () => {
  it('合并同一轮中的重复观察通知', async () => {
    const detect = vi.fn();
    const scheduler = createPageObservationScheduler(detect);

    scheduler.schedule();
    scheduler.schedule();
    await Promise.resolve();

    expect(detect).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('页面隐藏时不扫描，重新可见后补做一次检测', async () => {
    const detect = vi.fn();
    const scheduler = createPageObservationScheduler(detect);
    setVisibility('hidden');

    scheduler.schedule();
    await Promise.resolve();
    expect(detect).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(detect).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });
});
