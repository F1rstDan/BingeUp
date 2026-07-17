import { describe, expect, it, vi } from 'vitest';
import { TimedLearningAdapter, type VisibilityPort } from '@/adapters/timed-learning';
import type { VideoSiteAdapter } from '@/adapters/types';
import type { VideoChangeEvent } from '@/types';

interface DelegateOverrides {
  identity?: string;
  isAd?: boolean;
  isPreview?: boolean;
  isLive?: boolean;
  duration?: number;
  hasVideo?: boolean;
}

function makeHarness(overrides: DelegateOverrides = {}) {
  let now = 1_000_000;
  let intervalHandler: (() => void) | undefined;
  let baseHandler: ((event: VideoChangeEvent) => void) | undefined;
  let settings = {
    longVideoTimedLearningEnabled: false,
    longVideoIntervalMinutes: 10,
  };
  let hidden = false;
  const visibilityHandlers: Array<() => void> = [];

  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', {
    value: overrides.duration ?? 60 * 60,
    configurable: true,
  });

  const defaultIdentity = overrides.identity ?? 'video-1';
  let currentDelegateIdentity = defaultIdentity;
  const delegate: VideoSiteAdapter = {
    id: 'fake-video',
    matches: () => true,
    observePageChanges(handler) {
      baseHandler = handler;
      return () => undefined;
    },
    findPrimaryVideo: () => (overrides.hasVideo === false ? null : video),
    getVideoIdentity: () => currentDelegateIdentity,
    getOverlayTarget: () => video,
    getOverlayMode: () => 'video-region',
    isAdvertisement: () => overrides.isAd ?? false,
    isPreview: () => overrides.isPreview ?? false,
    isLivePage: () => overrides.isLive ?? false,
  };
  const clearInterval = vi.fn();
  const visibility: VisibilityPort = {
    isHidden: () => hidden,
    onChange(handler) {
      visibilityHandlers.push(handler);
      return () => {
        const idx = visibilityHandlers.indexOf(handler);
        if (idx >= 0) visibilityHandlers.splice(idx, 1);
      };
    },
  };
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
    visibility,
  });
  return {
    adapter,
    clearInterval,
    video,
    visibilityHandlers,
    emitBase(customIdentity?: string) {
      const id = customIdentity ?? defaultIdentity;
      currentDelegateIdentity = id;
      baseHandler?.({
        identity: id,
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
    disable() {
      settings = {
        longVideoTimedLearningEnabled: false,
        longVideoIntervalMinutes: settings.longVideoIntervalMinutes,
      };
    },
    setHidden(value: boolean) {
      hidden = value;
      visibilityHandlers.forEach((h) => h());
    },
    now() {
      return now;
    },
  };
}

describe('TimedLearningAdapter — 长视频定时学习（Issue #24）', () => {
  describe('AC1：默认关闭时不因冷却结束重复弹题', () => {
    it('设置关闭时同一视频不会产生额外自然触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.advance(60 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });

    it('关闭状态下经过多个间隔仍不产生定时触发', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();

      for (let i = 0; i < 5; i++) {
        harness.advance(20 * 60_000);
        await harness.tick();
      }

      expect(events).toHaveLength(1);
    });
  });

  describe('AC2：开启后按 10/20/30 分钟及自定义间隔产生触发点', () => {
    it('10 分钟间隔：到时间产生新的自然触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toContain('timed:video-1:');
    });

    it('20 分钟间隔：到时间产生新的自然触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(20);
      harness.advance(20 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(2);
    });

    it('30 分钟间隔：到时间产生新的自然触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(30);
      harness.advance(30 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(2);
    });

    it('合法自定义间隔（如 7 分钟）也可触发', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(7);
      harness.advance(7 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(2);
    });

    it('间隔未到不触发', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(9 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });

    it('同一长视频可按间隔产生多次触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      harness.advance(10 * 60_000);
      await harness.tick();
      harness.advance(10 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(3);
    });

    it('视频时长不足间隔不触发（非直播）', async () => {
      const harness = makeHarness({ duration: 5 * 60, isLive: false });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });
  });

  describe('AC3：直播默认只在首次进入时触发，开启后才按间隔重复', () => {
    it('直播页关闭定时学习时只产生首次触发', async () => {
      const harness = makeHarness({ isLive: true });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();

      for (let i = 0; i < 3; i++) {
        harness.advance(20 * 60_000);
        await harness.tick();
      }

      expect(events).toHaveLength(1);
    });

    it('直播页开启定时学习后按间隔重复触发', async () => {
      const harness = makeHarness({ isLive: true });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      harness.advance(10 * 60_000);
      await harness.tick();
      harness.advance(10 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(3);
    });

    it('直播页不受视频时长限制（duration 为 NaN/Infinity 仍可触发）', async () => {
      const harness = makeHarness({ isLive: true, duration: NaN });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(2);
    });
  });

  describe('AC4：广告/预览状态过滤候选触发点', () => {
    it('广告播放时不产生定时触发点', async () => {
      const harness = makeHarness({ isAd: true });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });

    it('预览视频不产生定时触发点', async () => {
      const harness = makeHarness({ isPreview: true });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });

    it('无主视频时不产生定时触发点', async () => {
      const harness = makeHarness({ hasVideo: false });
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);
      harness.advance(10 * 60_000);

      await harness.tick();

      expect(events).toHaveLength(1);
    });
  });

  describe('AC5：修改开关或间隔后使用最新设置', () => {
    it('运行中开启定时学习后下一次检查即可触发', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();

      // 关闭状态：不触发
      harness.advance(15 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(1);

      // 开启后：等待间隔即可触发
      harness.enable(10);
      harness.advance(10 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(2);
    });

    it('运行中修改间隔后使用新间隔', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(20);

      // 10 分钟（旧间隔 20 分钟未到）→ 不触发
      harness.advance(10 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(1);

      // 改为 10 分钟间隔后下一次检查即可触发（已过 10 分钟）
      harness.enable(10);
      await harness.tick();

      expect(events).toHaveLength(2);
    });

    it('运行中关闭后不再产生定时触发', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      harness.advance(10 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(2);

      harness.disable();
      harness.advance(10 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(2);
    });
  });

  describe('AC6：页面隐藏、身份变化、停止时清理调度状态', () => {
    it('页面隐藏时不产生定时触发点', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      harness.setHidden(true);
      harness.advance(10 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(1);
    });

    it('页面隐藏后恢复可见需重新等待完整间隔', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      // 已等待 8 分钟
      harness.advance(8 * 60_000);
      // 隐藏：清理调度基准
      harness.setHidden(true);
      // 隐藏期间再过 5 分钟
      harness.advance(5 * 60_000);
      // 恢复可见
      harness.setHidden(false);
      await harness.tick();

      // 恢复后只过了 0 分钟（基准被重置），不应触发
      expect(events).toHaveLength(1);

      // 再等 10 分钟才触发
      harness.advance(10 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(2);
    });

    it('内容身份变化时重置调度基准', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase('video-A');
      harness.enable(10);

      // 等待 8 分钟
      harness.advance(8 * 60_000);
      // 切换到新视频
      harness.emitBase('video-B');
      // 从新视频开始只过了 2 分钟 → 不触发
      harness.advance(2 * 60_000);
      await harness.tick();

      expect(events).toHaveLength(2); // A 的首次 + B 的首次

      // 再等 8 分钟（共 10 分钟）→ 触发 B 的定时
      harness.advance(8 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(3);
      expect(events[2]?.identity).toContain('timed:video-B:');
    });

    it('停止后清理计时器和监听', async () => {
      const harness = makeHarness();
      const events: VideoChangeEvent[] = [];
      const stop = harness.adapter.observePageChanges((event) => events.push(event));
      harness.emitBase();
      harness.enable(10);

      stop();

      expect(harness.clearInterval).toHaveBeenCalledWith(7);
      // 停止后即使到时间也不触发
      harness.advance(10 * 60_000);
      await harness.tick();
      expect(events).toHaveLength(1);
    });

    it('停止后可见性监听被移除', () => {
      const harness = makeHarness();
      const stop = harness.adapter.observePageChanges(() => undefined);
      expect(harness.visibilityHandlers).toHaveLength(1);

      stop();

      expect(harness.visibilityHandlers).toHaveLength(0);
    });
  });

  describe('AC7：扩展上下文失效后停止定时器', () => {
    it('settings.get() 抛出 "Extension context invalidated" 时停止定时器', async () => {
      let intervalHandler: (() => void) | undefined;
      const clearInterval = vi.fn();
      const video = document.createElement('video');
      Object.defineProperty(video, 'duration', { value: 60 * 60, configurable: true });

      const adapter = new TimedLearningAdapter(
        {
          id: 'fake-video',
          matches: () => true,
          observePageChanges: () => () => undefined,
          findPrimaryVideo: () => video,
          getVideoIdentity: () => 'video-1',
          getOverlayTarget: () => video,
          getOverlayMode: () => 'video-region',
          isAdvertisement: () => false,
          isPreview: () => false,
          isLivePage: () => false,
        },
        {
          settings: {
            get: async () => {
              throw new Error('Extension context invalidated.');
            },
          },
          clock: { now: () => Date.now() },
          timers: {
            setInterval(handler) {
              intervalHandler = handler;
              return 7;
            },
            clearInterval,
          },
          visibility: {
            isHidden: () => false,
            onChange: () => () => undefined,
          },
        },
      );

      const events: VideoChangeEvent[] = [];
      const stop = adapter.observePageChanges((event) => events.push(event));

      // 触发 timer 回调
      intervalHandler?.();
      await Promise.resolve();
      await Promise.resolve();

      // 定时器应被停止
      expect(clearInterval).toHaveBeenCalledWith(7);

      stop();
    });
  });

  describe('原有行为保持', () => {
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
});
