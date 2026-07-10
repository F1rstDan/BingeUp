import { describe, expect, it, vi } from 'vitest';
import { ContentController } from '@/content/content-controller';
import { applyComplete, applySkip, type CooldownConfig } from '@/cooldown/cooldown-rules';
import type {
  CooldownState,
  InteractionOutcome,
  OverlayMode,
  VideoChangeEvent,
} from '@/types';
import type { VideoPlaybackPort } from '@/video/playback-controller';

const NOW = 1_000_000;
const MS_PER_MIN = 60_000;

/** 刷新待处理的异步工作（控制器内部有多层 await）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CONFIG: CooldownConfig = {
  defaultCooldownMinutes: 2,
  consecutiveSkipCooldowns: [5, 15, 60],
};

/** 假视频播放端口，记录 pause/play。 */
function fakePlayback(opts: { playing?: boolean } = {}): VideoPlaybackPort & {
  pauseCalls: number;
  playCalls: number;
} {
  const f = {
    paused: !(opts.playing ?? true),
    ended: false,
    currentTime: 10,
    playbackRate: 1,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      f.pauseCalls += 1;
      f.paused = true;
    },
    async play() {
      f.playCalls += 1;
      f.paused = false;
    },
  };
  return f;
}

/** 假站点适配器：测试通过 emit 触发视频变化事件。 */
function fakeAdapter() {
  let handler: ((e: VideoChangeEvent) => void) | null = null;
  return {
    onVideoChange(h: (e: VideoChangeEvent) => void) {
      handler = h;
      return () => {
        handler = null;
      };
    },
    emit(identity: string, video: unknown, overlayTarget: unknown = {}, overlayMode: OverlayMode = 'video-region') {
      handler?.({
        identity,
        video: video as HTMLVideoElement | null,
        overlayTarget: overlayTarget as HTMLElement | DOMRect | null,
        overlayMode,
      });
    },
  };
}

/** 假遮罩：记录 open/close，测试通过 fireOutcome 模拟用户。 */
function fakeOverlay() {
  let outcomeHandler: ((o: InteractionOutcome) => void) | null = null;
  const state = {
    openCalls: 0,
    closeCalls: 0,
    lastTarget: null as unknown,
    lastMode: null as OverlayMode | null,
    onOutcome(h: (o: InteractionOutcome) => void) {
      outcomeHandler = h;
    },
    open(target: HTMLElement | DOMRect, mode: OverlayMode) {
      state.openCalls += 1;
      state.lastTarget = target;
      state.lastMode = mode;
    },
    close() {
      state.closeCalls += 1;
    },
    fireOutcome(o: InteractionOutcome) {
      outcomeHandler?.(o);
    },
  };
  return state;
}

/** 假冷却存储：内存态，用冷却规则计算结果，测试可预置初始状态。 */
function fakeCooldownStore(initial: CooldownState = { nextAllowedAt: 0, consecutiveSkipCount: 0 }) {
  const store = {
    current: { ...initial },
    recordCalls: 0,
    async get() {
      return { ...store.current };
    },
    async recordOutcome(outcome: InteractionOutcome) {
      store.recordCalls += 1;
      const now = NOW;
      store.current =
        outcome === 'submitted'
          ? applyComplete(now, CONFIG)
          : applySkip(store.current, now, CONFIG);
    },
  };
  return store;
}

/** 假站点状态端口。 */
function fakeSiteState(firstPending: boolean) {
  const s = {
    firstQuestionPending: firstPending,
    handledCalls: 0,
    async isFirstQuestionPending() {
      return s.firstQuestionPending;
    },
    async markFirstQuestionHandled() {
      s.handledCalls += 1;
      s.firstQuestionPending = false;
    },
  };
  return s;
}

function makeController(opts: {
  cooldown?: CooldownState;
  firstPending?: boolean;
  playback?: VideoPlaybackPort & { pauseCalls: number; playCalls: number };
} = {}) {
  const adapter = fakeAdapter();
  const overlay = fakeOverlay();
  const cooldownStore = fakeCooldownStore(opts.cooldown);
  const siteState = fakeSiteState(opts.firstPending ?? false);
  const playback = opts.playback ?? fakePlayback({ playing: true });
  const clock = { now: () => NOW };
  const videoPortFor = vi.fn(() => playback);

  const controller = new ContentController({
    adapter,
    overlay,
    cooldownStore,
    clock,
    videoPortFor,
    siteState,
  });
  controller.start();

  return { controller, adapter, overlay, cooldownStore, siteState, playback, videoPortFor };
}

describe('ContentController — 核心闭环编排', () => {
  describe('触发与暂停', () => {
    it('新视频 + 冷却已结束 → 暂停视频并打开遮罩', async () => {
      const { adapter, overlay, playback } = makeController();

      adapter.emit('bv-1', {});
      await flush();

      expect(playback.pauseCalls).toBe(1);
      expect(overlay.openCalls).toBe(1);
    });

    it('冷却未结束且非首次触发 → 不打开遮罩', async () => {
      const { adapter, overlay } = makeController({
        cooldown: { nextAllowedAt: NOW + 10_000, consecutiveSkipCount: 0 },
        firstPending: false,
      });

      adapter.emit('bv-1', {});
      await flush();

      expect(overlay.openCalls).toBe(0);
    });

    it('首次触发例外：冷却未结束但首次触发待处理 → 仍打开遮罩', async () => {
      const { adapter, overlay } = makeController({
        cooldown: { nextAllowedAt: NOW + 10_000, consecutiveSkipCount: 0 },
        firstPending: true,
      });

      adapter.emit('bv-1', {});
      await flush();

      expect(overlay.openCalls).toBe(1);
    });

    it('同一视频 identity 重复发出 → 只打开一次遮罩', async () => {
      const { adapter, overlay } = makeController();

      adapter.emit('bv-1', {});
      await flush();
      adapter.emit('bv-1', {});
      await flush();

      expect(overlay.openCalls).toBe(1);
    });

    it('视频为 null 的事件 → 不打开遮罩', async () => {
      const { adapter, overlay } = makeController();

      adapter.emit('bv-1', null);
      await flush();

      expect(overlay.openCalls).toBe(0);
    });
  });

  describe('提交后恢复与冷却', () => {
    it('提交 → 关闭遮罩、恢复播放、应用默认冷却、清零跳过计数', async () => {
      const { adapter, overlay, playback, cooldownStore, siteState } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireOutcome('submitted');
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 2 * MS_PER_MIN,
        consecutiveSkipCount: 0,
      });
    });

    it('首次触发提交后标记首次触发已处理', async () => {
      const { adapter, overlay, siteState } = makeController({ firstPending: true });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireOutcome('submitted');
      await flush();

      expect(siteState.handledCalls).toBe(1);
      expect(siteState.firstQuestionPending).toBe(false);
    });
  });

  describe('跳过后恢复与冷却', () => {
    it('跳过 → 关闭遮罩、恢复播放、进入 5 分钟冷却', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireOutcome('skipped');
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 5 * MS_PER_MIN,
        consecutiveSkipCount: 1,
      });
    });
  });

  describe('原本暂停的视频', () => {
    it('交互结束后不恢复播放（保持暂停）', async () => {
      const { adapter, overlay, playback } = makeController({
        playback: fakePlayback({ playing: false }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireOutcome('submitted');
      await flush();

      expect(playback.playCalls).toBe(0);
    });
  });

  describe('防重复', () => {
    it('重复提交只执行一次关闭、一次恢复、一次冷却更新', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeController();

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireOutcome('submitted');
      await flush();
      overlay.fireOutcome('submitted');
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.recordCalls).toBe(1);
    });
  });
});
