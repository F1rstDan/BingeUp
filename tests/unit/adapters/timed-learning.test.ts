import { describe, expect, it, vi } from 'vitest';
import { TimedLearningAdapter } from '@/adapters/timed-learning';
import type { VideoSiteAdapter } from '@/adapters/types';
import type { VideoChangeEvent } from '@/types';

function makeHarness() {
  let now = 1_000_000;
  let intervalHandler: (() => void) | undefined;
  let baseHandler: ((event: VideoChangeEvent) => void) | undefined;
  let settings = {
    longVideoTimedLearningEnabled: false,
    longVideoIntervalMinutes: 10,
  };
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: 60 * 60, configurable: true });
  const delegate: VideoSiteAdapter = {
    id: 'fake-video',
    matches: () => true,
    observePageChanges(handler) {
      baseHandler = handler;
      return () => undefined;
    },
    findPrimaryVideo: () => video,
    getVideoIdentity: () => 'video-1',
    getOverlayTarget: () => video,
    getOverlayMode: () => 'video-region',
    isAdvertisement: () => false,
    isPreview: () => false,
    isLivePage: () => false,
  };
  const clearInterval = vi.fn();
  const adapter = new TimedLearningAdapter(delegate, {
    settings: { get: async () => settings },
    clock: { now: () => now },
    timers: {
      setInterval(handler) {
        intervalHandler = handler;
        return 7;
      },
      clearInterval,
    },
  });
  return {
    adapter,
    clearInterval,
    emitBase() {
      baseHandler?.({
        identity: 'video-1',
        video,
        overlayTarget: video,
        overlayMode: 'video-region',
      });
    },
    async tick() {
      intervalHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    advance(milliseconds: number) {
      now += milliseconds;
    },
    enable(intervalMinutes: number) {
      settings = {
        longVideoTimedLearningEnabled: true,
        longVideoIntervalMinutes: intervalMinutes,
      };
    },
  };
}

describe('TimedLearningAdapter — 长视频定时学习（Issue #22）', () => {
  it('设置关闭时同一视频不会产生额外自然触发点', async () => {
    const harness = makeHarness();
    const events: VideoChangeEvent[] = [];
    harness.adapter.observePageChanges((event) => events.push(event));
    harness.emitBase();
    harness.advance(60 * 60_000);

    await harness.tick();

    expect(events).toHaveLength(1);
  });

  it('保存开启设置后按最新间隔为同一长视频产生额外自然触发点', async () => {
    const harness = makeHarness();
    const events: VideoChangeEvent[] = [];
    const stop = harness.adapter.observePageChanges((event) => events.push(event));
    harness.emitBase();
    harness.enable(5);
    harness.advance(5 * 60_000);

    await harness.tick();

    expect(events).toHaveLength(2);
    expect(events[1]?.identity).toContain('timed:video-1:');
    stop();
    expect(harness.clearInterval).toHaveBeenCalledWith(7);
  });
});
