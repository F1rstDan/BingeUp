import { describe, expect, it, vi } from 'vitest';
import { ContentController } from '@/content/content-controller';
import { applyComplete, applySkip, type CooldownConfig } from '@/cooldown/cooldown-rules';
import { TimedLearningAdapter, type VisibilityPort } from '@/adapters/timed-learning';
import type { VideoSiteAdapter } from '@/adapters/types';
import { normalizeLearningContext } from '@/content/learning-context';
import type {
  CooldownState,
  LearningItem,
  OverlayAction,
  OverlayMode,
  SessionLogRecord,
  VideoChangeEvent,
} from '@/types';
import type { VideoPlaybackPort } from '@/video/playback-controller';

const NOW = 1_000_000;
const MS_PER_MIN = 60_000;

const CONFIG: CooldownConfig = {
  defaultCooldownMinutes: 2,
  consecutiveSkipCooldowns: [5, 15, 60],
};

const LEARNING_ITEM: LearningItem = {
  kind: 'question',
  question: {
    id: 'q-1',
    type: 'en-to-zh',
    cardId: 'card-1',
    wordId: 'w-1',
    prompt: 'abandon',
    options: ['放弃', '建造', '聚集', '转移'],
    correctIndex: 0,
    explanation: {
      word: 'abandon',
      partOfSpeech: ['v.'],
      meanings: ['放弃'],
    },
  },
};

/** 刷新待处理的异步工作（控制器内部有多层 await）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 假视频播放端口，记录 pause/play。 */
function fakePlayback(opts: { playing?: boolean } = {}): VideoPlaybackPort & {
  pauseCalls: number;
  playCalls: number;
  setPlaying(playing: boolean): void;
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
    setPlaying(playing: boolean) {
      f.paused = !playing;
    },
  };
  return f;
}

/** 假站点适配器：测试通过 emit 触发视频变化事件。 */
function fakeAdapter() {
  let handler: ((e: VideoChangeEvent) => void) | null = null;
  let currentEvent: VideoChangeEvent | null = null;
  return {
    onVideoChange(h: (e: VideoChangeEvent) => void) {
      handler = h;
      return () => {
        handler = null;
      };
    },
    emit(
      identity: string,
      video: unknown,
      overlayTarget: unknown = {},
      overlayMode: OverlayMode = 'video-region',
    ) {
      currentEvent = {
        identity,
        video: video as HTMLVideoElement | null,
        overlayTarget: overlayTarget as HTMLElement | DOMRect | null,
        overlayMode,
      };
      handler?.(currentEvent);
    },
    /** 设置当前主视频事件（用于主动触发连续学习测试）。 */
    setCurrentEvent(
      identity: string,
      video: unknown,
      overlayTarget: unknown = {},
      overlayMode: OverlayMode = 'video-region',
    ) {
      currentEvent = {
        identity,
        video: video as HTMLVideoElement | null,
        overlayTarget: overlayTarget as HTMLElement | DOMRect | null,
        overlayMode,
      };
    },
    getCurrentLearningContext() {
      return currentEvent;
    },
  };
}

/** 假遮罩：记录 open/close，测试通过 fireAction 模拟用户。 */
function fakeOverlay() {
  let actionHandler: ((a: OverlayAction) => void) | null = null;
  const state = {
    openCalls: 0,
    closeCalls: 0,
    lastItem: null as LearningItem | null,
    lastTarget: null as unknown,
    lastMode: null as OverlayMode | null,
    lastOptions: undefined as unknown,
    onAction(h: (a: OverlayAction) => void) {
      actionHandler = h;
    },
    open(item: LearningItem, target: HTMLElement | DOMRect, mode: OverlayMode, options?: unknown) {
      state.openCalls += 1;
      state.lastItem = item;
      state.lastTarget = target;
      state.lastMode = mode;
      state.lastOptions = options;
    },
    close() {
      state.closeCalls += 1;
    },
    fireAction(a: OverlayAction) {
      actionHandler?.(a);
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
    async recordOutcome(outcome: 'submitted' | 'skipped') {
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
    enabled: true,
    firstQuestionPending: firstPending,
    handledCalls: 0,
    async isEnabled() {
      return s.enabled;
    },
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

/** 假学习服务：可配置返回的学习项目和追踪调用。 */
function fakeLearningService(item: LearningItem | null = LEARNING_ITEM) {
  const svc = {
    nextItemCalls: 0,
    nextItemOptions: [] as Array<
      | {
          excludedWordIds?: Set<string>;
          allowSpelling?: boolean;
          allowEarlyShortTermReview?: boolean;
        }
      | undefined
    >,
    acceptCalls: [] as string[],
    selfReportCalls: [] as string[],
    submitCalls: 0,
    submitSpellingCalls: 0,
    correctRatingCalls: 0,
    item,
    items: null as LearningItem[] | null,
    itemIndex: 0,
    async getNextItem(options?: {
      excludedWordIds?: Set<string>;
      allowSpelling?: boolean;
      allowEarlyShortTermReview?: boolean;
    }) {
      svc.nextItemCalls += 1;
      svc.nextItemOptions.push(options);
      // 如果配置了多项目序列（用于连续模式测试），按序返回
      if (svc.items !== null) {
        if (svc.itemIndex >= svc.items.length) return null;
        return svc.items[svc.itemIndex++] ?? null;
      }
      return svc.item;
    },
    async acceptNewWord(wordId: string) {
      svc.acceptCalls.push(wordId);
    },
    async selfReportKnown(wordId: string) {
      svc.selfReportCalls.push(wordId);
    },
    async submitAnswer() {
      svc.submitCalls += 1;
      return {
        isCorrect: true,
        correctIndex: 0,
        correctAnswer: '放弃',
        cardId: 'card-1',
        reviewLogId: 'log-1',
        explanation: { word: 'abandon', partOfSpeech: ['v.'], meanings: ['放弃'] },
      };
    },
    async submitSpellingAnswer() {
      svc.submitSpellingCalls += 1;
      return {
        isCorrect: true,
        correctAnswer: 'abandon',
        cardId: 'card-1',
        reviewLogId: 'log-1',
        explanation: { word: 'abandon', partOfSpeech: ['v.'], meanings: ['放弃'] },
      };
    },
    async correctRating() {
      svc.correctRatingCalls += 1;
      return { cardId: 'card-1', reviewLogId: 'log-1', rating: 'good' as const };
    },
  };
  return svc;
}

/** 假会话日志端口：记录所有写入的会话日志（Issue #12）。 */
function fakeSessionLogger() {
  const logs: SessionLogRecord[] = [];
  return {
    logs,
    async save(log: SessionLogRecord) {
      logs.push(log);
    },
  };
}

function makeController(
  opts: {
    cooldown?: CooldownState;
    firstPending?: boolean;
    playback?: VideoPlaybackPort & { pauseCalls: number; playCalls: number };
    item?: LearningItem | null;
    withSessionLogger?: boolean;
    globallyPaused?: boolean;
    playbackRecoveryNotice?: { show(): Promise<void> };
  } = {},
) {
  const adapter = fakeAdapter();
  const overlay = fakeOverlay();
  const cooldownStore = fakeCooldownStore(opts.cooldown);
  const siteState = fakeSiteState(opts.firstPending ?? false);
  const playback = opts.playback ?? fakePlayback({ playing: true });
  const clock = { now: () => NOW };
  const videoPortFor = vi.fn(() => playback);
  const learningService = fakeLearningService(opts.item);
  const sessionLogger = opts.withSessionLogger ? fakeSessionLogger() : undefined;
  const pauseState = {
    async isGloballyPaused() {
      return opts.globallyPaused ?? false;
    },
  };

  const controllerDeps = {
    adapter,
    overlay,
    cooldownStore,
    clock,
    videoPortFor,
    siteState,
    learningService,
    sessionLogger,
    pauseState,
    playbackRecoveryNotice: opts.playbackRecoveryNotice,
  };
  const controller = new ContentController(controllerDeps);
  controller.start();

  return {
    controller,
    adapter,
    overlay,
    cooldownStore,
    siteState,
    playback,
    videoPortFor,
    learningService,
    sessionLogger,
  };
}

/** 连续学习用的第二道题（拼写题）。 */
const SPELLING_ITEM: LearningItem = {
  kind: 'spelling-question',
  question: {
    id: 'q-spelling-1',
    type: 'spelling',
    cardId: 'card-2',
    wordId: 'w-2',
    prompt: '吸收',
    correctAnswer: 'absorb',
    explanation: {
      word: 'absorb',
      partOfSpeech: ['v.'],
      meanings: ['吸收'],
    },
  },
};

/** 构造可返回多项目的控制器（用于连续模式测试）。 */
function makeContinuousController(
  opts: {
    items: LearningItem[];
    cooldown?: CooldownState;
    firstPending?: boolean;
    withSessionLogger?: boolean;
  } = { items: [LEARNING_ITEM, SPELLING_ITEM] },
) {
  const adapter = fakeAdapter();
  const overlay = fakeOverlay();
  const cooldownStore = fakeCooldownStore(opts.cooldown);
  const siteState = fakeSiteState(opts.firstPending ?? false);
  const playback = fakePlayback({ playing: true });
  const clock = { now: () => NOW };
  const videoPortFor = vi.fn(() => playback);
  const learningService = fakeLearningService();
  learningService.items = opts.items;
  learningService.itemIndex = 0;
  const sessionLogger = opts.withSessionLogger ? fakeSessionLogger() : undefined;

  const controller = new ContentController({
    adapter,
    overlay,
    cooldownStore,
    pauseState: {
      async isGloballyPaused() {
        return false;
      },
    },
    clock,
    videoPortFor,
    siteState,
    learningService,
    sessionLogger,
  });
  controller.start();

  return {
    controller,
    adapter,
    overlay,
    cooldownStore,
    siteState,
    playback,
    videoPortFor,
    learningService,
    sessionLogger,
  };
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

    it('学习项目加载延迟时，视频先暂停且打开遮罩时仍保持暂停', async () => {
      const { adapter, overlay, playback, learningService } = makeController();
      let resolveItem!: (item: LearningItem | null) => void;
      const itemPromise = new Promise<LearningItem | null>((resolve) => {
        resolveItem = resolve;
      });
      learningService.getNextItem = async () => itemPromise;

      adapter.emit('bv-1', {});
      await flush();

      expect(playback.pauseCalls).toBe(1);
      expect(playback.paused).toBe(true);

      resolveItem(LEARNING_ITEM);
      await flush();

      expect(overlay.openCalls).toBe(1);
      expect(playback.paused).toBe(true);
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

    it('A→B→A 只阻止连续重复，返回 A 在冷却满足后可再次触发', async () => {
      const { adapter, overlay, cooldownStore } = makeController();

      adapter.emit('A', {});
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();
      cooldownStore.current.nextAllowedAt = 0;

      adapter.emit('B', {});
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();
      cooldownStore.current.nextAllowedAt = 0;

      adapter.emit('A', {});
      await flush();

      expect(overlay.openCalls).toBe(3);
    });

    it('交互期间出现的新内容在内部恢复后作为待处理自然触发继续执行', async () => {
      const { adapter, overlay, cooldownStore } = makeController();

      adapter.emit('basic-load', null, document.documentElement, 'full-page');
      await flush();
      adapter.emit('generic-video', {}, document.documentElement, 'full-page');
      await flush();

      overlay.fireAction({ type: 'recover' });
      await flush();

      expect(overlay.openCalls).toBe(2);
      expect(overlay.lastMode).toBe('full-page');
      expect(cooldownStore.recordCalls).toBe(0);
    });

    it('视频为 null 的事件 → 基础网页模式下仍打开遮罩（Issue #11）', async () => {
      const { adapter, overlay } = makeController();

      adapter.emit('bv-1', null);
      await flush();

      expect(overlay.openCalls).toBe(1);
    });

    it('学习服务无内容（getNextItem 返回 null）→ 恢复原播放状态且不打开遮罩', async () => {
      const { adapter, overlay, playback } = makeController({ item: null });

      adapter.emit('bv-1', {});
      await flush();

      expect(overlay.openCalls).toBe(0);
      expect(playback.pauseCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(playback.paused).toBe(false);
    });

    it('学习服务获取失败时恢复原播放状态且不打开遮罩', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { adapter, overlay, playback, learningService } = makeController();
      learningService.getNextItem = async () => {
        throw new Error('模拟取题失败');
      };

      adapter.emit('bv-1', {});
      await flush();

      expect(overlay.openCalls).toBe(0);
      expect(playback.pauseCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(playback.paused).toBe(false);
      // 断言故障日志，避免未断言的错误日志噪声
      expect(errorSpy).toHaveBeenCalledWith(
        '[BingeUp] 学习交互失败，正在返回视频',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  describe('提交后恢复与冷却', () => {
    it('提交答案 → 不关闭遮罩（进入反馈阶段）', async () => {
      const { adapter, overlay, learningService } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-answer',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(learningService.submitCalls).toBe(1);
      // submit-answer 是软动作：不关闭遮罩
      expect(overlay.closeCalls).toBe(0);
    });

    it('提交后继续 → 关闭遮罩、恢复播放、应用默认冷却', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({
        type: 'submit-answer',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      // 提交后继续 → 'submitted' 冷却
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 2 * MS_PER_MIN,
        consecutiveSkipCount: 0,
      });
    });

    it('首次触发提交后标记首次触发已处理', async () => {
      const { adapter, overlay, siteState } = makeController({ firstPending: true });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({
        type: 'submit-answer',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();

      expect(siteState.handledCalls).toBe(1);
      expect(siteState.firstQuestionPending).toBe(false);
    });
  });

  describe('跳过后恢复与冷却', () => {
    it('直接跳过（未提交）→ 关闭遮罩、恢复播放、进入 5 分钟冷却', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 5 * MS_PER_MIN,
        consecutiveSkipCount: 1,
      });
    });
  });

  describe('新词展示动作', () => {
    it('知道了 → 调用 acceptNewWord、关闭遮罩、恢复播放、默认冷却', async () => {
      const { adapter, overlay, playback, cooldownStore, learningService } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({ type: 'accept-new-word', wordId: 'w-new' });
      await flush();

      expect(learningService.acceptCalls).toEqual(['w-new']);
      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 2 * MS_PER_MIN,
        consecutiveSkipCount: 0,
      });
    });

    it('我认识换一个 → 调用 selfReportKnown、关闭遮罩、默认冷却', async () => {
      const { adapter, overlay, playback, cooldownStore, learningService } = makeController({
        playback: fakePlayback({ playing: true }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({ type: 'self-report', wordId: 'w-known' });
      await flush();

      expect(learningService.selfReportCalls).toEqual(['w-known']);
      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current.consecutiveSkipCount).toBe(0);
    });
  });

  describe('原本暂停的视频', () => {
    it('交互结束后不恢复播放（保持暂停）', async () => {
      const { adapter, overlay, playback } = makeController({
        playback: fakePlayback({ playing: false }),
      });

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();

      expect(playback.playCalls).toBe(0);
    });
  });

  describe('防重复', () => {
    it('重复终态动作只执行一次关闭、一次恢复、一次冷却更新', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeController();

      adapter.emit('bv-1', {});
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();
      overlay.fireAction({ type: 'skip' });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.recordCalls).toBe(1);
    });
  });
});

// ─── Issue #8：连续学习模式 ──────────────────────────────────────

describe('ContentController — 连续学习模式（Issue #8）', () => {
  describe('验收标准 1：提交并继续', () => {
    it('submit-and-continue 提交选择题并加载下一题（不关闭遮罩）', async () => {
      const { adapter, overlay, learningService } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(learningService.submitCalls).toBe(1);
      expect(overlay.closeCalls).toBe(0);
      expect(overlay.openCalls).toBe(2); // 初始 + 连续下一题
    });

    it('submit-and-continue 保持视频暂停', async () => {
      const { adapter, overlay, playback } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(playback.playCalls).toBe(0); // 未恢复播放
    });

    it('连续学习加载下一题前重新暂停被外部恢复播放的视频', async () => {
      const { adapter, overlay, playback } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();
      playback.setPlaying(true);

      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(playback.pauseCalls).toBe(2);
      expect(playback.paused).toBe(true);
      expect(overlay.openCalls).toBe(2);
    });

    it('submit-and-continue 传入 excludedWordIds 和 allowSpelling', async () => {
      const { adapter, overlay, learningService } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      // 第二次 getNextItem 调用应包含 options
      expect(learningService.nextItemOptions[1]).toBeDefined();
      expect(learningService.nextItemOptions[1]!.allowSpelling).toBe(true);
      expect(learningService.nextItemOptions[1]!.excludedWordIds).toBeDefined();
      expect(learningService.nextItemOptions[1]!.excludedWordIds!.has('w-1')).toBe(true);
    });

    it('submit-and-continue 传入 previousFeedback 和 isContinuous', async () => {
      const { adapter, overlay } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      const options = overlay.lastOptions as { previousFeedback?: unknown; isContinuous?: boolean };
      expect(options).toBeDefined();
      expect(options.isContinuous).toBe(true);
      expect(options.previousFeedback).toBeDefined();
    });

    it('从单题反馈进入连续模式：submit-answer 后 submit-and-continue 不重复提交', async () => {
      const { adapter, overlay, learningService } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      // 单题模式：先提交答案（软动作，进入反馈阶段）
      overlay.fireAction({
        type: 'submit-answer',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();
      expect(learningService.submitCalls).toBe(1);

      // 反馈阶段选择"提交并继续"进入连续模式
      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      // 不应重复提交
      expect(learningService.submitCalls).toBe(1);
      expect(overlay.closeCalls).toBe(0);
      expect(overlay.openCalls).toBe(2);
      const options = overlay.lastOptions as { isContinuous?: boolean };
      expect(options?.isContinuous).toBe(true);
    });
  });

  describe('验收标准 1：提交拼写题并继续', () => {
    it('submit-spelling-and-continue 提交拼写题并加载下一题', async () => {
      const { adapter, overlay, learningService } = makeContinuousController({
        items: [SPELLING_ITEM, LEARNING_ITEM],
      });

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'submit-spelling-and-continue',
        question: SPELLING_ITEM.question,
        spelledAnswer: 'absorb',
        responseTimeMs: 2000,
      });
      await flush();

      expect(learningService.submitSpellingCalls).toBe(1);
      expect(overlay.closeCalls).toBe(0);
      expect(overlay.openCalls).toBe(2);
    });
  });

  describe('提交并结束', () => {
    it('submit-and-end 提交选择题并关闭连续学习，按完成记录', async () => {
      const {
        controller,
        adapter,
        overlay,
        playback,
        cooldownStore,
        learningService,
        sessionLogger,
      } = makeContinuousController({
        items: [LEARNING_ITEM],
        withSessionLogger: true,
      });

      adapter.setCurrentEvent('bv-1', {});
      await controller.startContinuousLearning();
      await flush();

      overlay.fireAction({
        type: 'submit-and-end',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(learningService.submitCalls).toBe(1);
      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 2 * MS_PER_MIN,
        consecutiveSkipCount: 0,
      });
      expect(sessionLogger?.logs[0]).toMatchObject({
        mode: 'continuous',
        outcome: 'submitted',
        questionsAnswered: 1,
      });
    });

    it('submit-spelling-and-end 提交拼写题并关闭连续学习', async () => {
      const { controller, adapter, overlay, playback, learningService } = makeContinuousController({
        items: [SPELLING_ITEM],
      });

      adapter.setCurrentEvent('bv-1', {});
      await controller.startContinuousLearning();
      await flush();

      overlay.fireAction({
        type: 'submit-spelling-and-end',
        question: SPELLING_ITEM.question,
        spelledAnswer: 'absorb',
        responseTimeMs: 2000,
      });
      await flush();

      expect(learningService.submitSpellingCalls).toBe(1);
      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
    });
  });

  describe('验收标准 1：新词展示并继续', () => {
    it('accept-new-word-and-continue 接受新词并加载下一题', async () => {
      const newWordItem: LearningItem = {
        kind: 'new-word-presentation',
        presentation: {
          word: {
            id: 'w-new',
            word: 'newword',
            lemma: 'newword',
            partOfSpeech: ['n.'],
            coreMeaningZh: ['新词'],
            exampleSentence: 'This is a new word.',
            exampleTranslation: '这是一个新词。',
            difficulty: 1,
            source: 'test',
            license: 'CC0',
          },
        },
      };

      const { adapter, overlay, learningService } = makeContinuousController({
        items: [newWordItem, LEARNING_ITEM],
      });

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'accept-new-word-and-continue',
        wordId: 'w-new',
      });
      await flush();

      expect(learningService.acceptCalls).toEqual(['w-new']);
      expect(overlay.closeCalls).toBe(0);
      expect(overlay.openCalls).toBe(2);
    });

    it('self-report-and-continue 自报认识并加载下一题', async () => {
      const newWordItem: LearningItem = {
        kind: 'new-word-presentation',
        presentation: {
          word: {
            id: 'w-known',
            word: 'knownword',
            lemma: 'knownword',
            partOfSpeech: ['n.'],
            coreMeaningZh: ['已知词'],
            exampleSentence: 'I know this word.',
            exampleTranslation: '我认识这个词。',
            difficulty: 1,
            source: 'test',
            license: 'CC0',
          },
        },
      };

      const { adapter, overlay, learningService } = makeContinuousController({
        items: [newWordItem, LEARNING_ITEM],
      });

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({
        type: 'self-report-and-continue',
        wordId: 'w-known',
      });
      await flush();

      expect(learningService.selfReportCalls).toEqual(['w-known']);
      expect(overlay.closeCalls).toBe(0);
      expect(overlay.openCalls).toBe(2);
    });
  });

  describe('验收标准 4：结束学习', () => {
    it('exit-learning 不提交当前题、不算跳过、应用默认冷却', async () => {
      const { adapter, overlay, playback, cooldownStore } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      // 提交第一题并继续
      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      // 第二题不提交，直接结束学习
      overlay.fireAction({ type: 'exit-learning' });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      // 默认冷却（submitted），不是跳过
      expect(cooldownStore.current).toEqual({
        nextAllowedAt: NOW + 2 * MS_PER_MIN,
        consecutiveSkipCount: 0,
      });
    });

    it('exit-learning 在第一题就结束也应用默认冷却', async () => {
      const { adapter, overlay, cooldownStore } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      overlay.fireAction({ type: 'exit-learning' });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(cooldownStore.current.consecutiveSkipCount).toBe(0);
    });
  });

  describe('验收标准 5：无更多内容时自动结束', () => {
    it('连续模式中 getNextItem 返回 null → 自动结束，应用默认冷却', async () => {
      const { adapter, overlay, cooldownStore } = makeContinuousController({
        items: [LEARNING_ITEM], // 只有一个项目
      });

      adapter.emit('bv-1', {});
      await flush();

      // 提交第一题并继续 → 无更多内容 → 自动结束
      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(overlay.closeCalls).toBe(1);
      expect(cooldownStore.current.consecutiveSkipCount).toBe(0);
    });
  });

  describe('已提交后 submit-and-continue 不重复提交', () => {
    it('先 submit-answer 再 submit-and-continue 只提交一次', async () => {
      const { adapter, overlay, learningService } = makeContinuousController();

      adapter.emit('bv-1', {});
      await flush();

      // 先提交（软动作）
      overlay.fireAction({
        type: 'submit-answer',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      // 再提交并继续
      overlay.fireAction({
        type: 'submit-and-continue',
        question: LEARNING_ITEM.question,
        selectedIndex: 0,
        responseTimeMs: 1500,
      });
      await flush();

      expect(learningService.submitCalls).toBe(1); // 只提交一次
      expect(overlay.openCalls).toBe(2); // 加载了下一题
    });
  });
});

describe('ContentController — 主动连续学习入口（Issue #9 AC4）', () => {
  it('startContinuousLearning：有主视频时直接进入连续模式，绕过冷却', async () => {
    const { controller, adapter, overlay, playback, learningService } = makeController({
      cooldown: { nextAllowedAt: NOW + 10_000, consecutiveSkipCount: 0 },
    });
    adapter.setCurrentEvent('bv-1', {});

    const result = await controller.startContinuousLearning();
    await flush();

    expect(result).toEqual({ ok: true });
    expect(playback.pauseCalls).toBe(1);
    expect(overlay.openCalls).toBe(1);
    // 连续模式请求允许拼写题
    expect(learningService.nextItemOptions[0]).toMatchObject({
      allowSpelling: true,
      allowEarlyShortTermReview: true,
    });
    // options 标记为连续模式
    expect(overlay.lastOptions).toMatchObject({ isContinuous: true });
  });

  it('自然触发不允许主动巩固未到期短期学习词', async () => {
    const { adapter, learningService } = makeController();

    adapter.emit('bv-natural', {});
    await flush();

    expect(learningService.nextItemOptions[0]?.allowEarlyShortTermReview).not.toBe(true);
  });

  it('startContinuousLearning：基础网页上下文以全网页遮罩启动且不调用播放控制', async () => {
    const { controller, adapter, overlay, videoPortFor } = makeController({
      cooldown: { nextAllowedAt: NOW + 10_000, consecutiveSkipCount: 0 },
    });
    adapter.setCurrentEvent('basic-manual-1', null, document.documentElement, 'full-page');

    const result = await controller.startContinuousLearning();
    await flush();

    expect(result).toEqual({ ok: true });
    expect(videoPortFor).not.toHaveBeenCalled();
    expect(overlay.openCalls).toBe(1);
    expect(overlay.lastTarget).toBe(document.documentElement);
    expect(overlay.lastMode).toBe('full-page');
    expect(overlay.lastOptions).toMatchObject({ isContinuous: true });
  });

  it('startContinuousLearning：通用视频上下文暂停视频并使用全网页遮罩', async () => {
    const { controller, adapter, overlay, playback, videoPortFor } = makeController();
    adapter.setCurrentEvent('generic-manual-1', {}, document.documentElement, 'full-page');

    const result = await controller.startContinuousLearning();

    expect(result).toEqual({ ok: true });
    expect(videoPortFor).toHaveBeenCalledTimes(1);
    expect(playback.pauseCalls).toBe(1);
    expect(overlay.lastTarget).toBe(document.documentElement);
    expect(overlay.lastMode).toBe('full-page');
    expect(overlay.lastOptions).toMatchObject({ isContinuous: true });
  });

  it('startContinuousLearning：全局暂停时拒绝启动', async () => {
    const { controller, adapter, overlay, playback } = makeController({ globallyPaused: true });
    adapter.setCurrentEvent('bv-1', {});

    const result = await controller.startContinuousLearning();

    expect(result).toEqual({ ok: false, reason: 'globally-paused' });
    expect(playback.pauseCalls).toBe(0);
    expect(overlay.openCalls).toBe(0);
  });

  it('startContinuousLearning：无当前学习上下文时返回 context-unavailable', async () => {
    const { controller, overlay, playback } = makeController();
    // 未 setCurrentEvent → getCurrentLearningContext 返回 null
    const result = await controller.startContinuousLearning();
    await flush();

    expect(result).toEqual({ ok: false, reason: 'context-unavailable' });
    expect(playback.pauseCalls).toBe(0);
    expect(overlay.openCalls).toBe(0);
  });

  it('已有进行中的交互时返回 interaction-active', async () => {
    const { controller, adapter, overlay } = makeController();
    adapter.emit('bv-1', {});
    await flush();
    expect(overlay.openCalls).toBe(1);

    const result = await controller.startContinuousLearning();
    await flush();

    expect(result).toEqual({ ok: false, reason: 'interaction-active' });
    expect(overlay.openCalls).toBe(1); // 没有再次打开
  });

  it('并发启动时只允许第一个请求打开学习界面', async () => {
    const { controller, adapter, overlay } = makeController();
    adapter.setCurrentEvent('bv-1', {});

    const first = controller.startContinuousLearning();
    const second = await controller.startContinuousLearning();

    expect(second).toEqual({ ok: false, reason: 'interaction-active' });
    expect(await first).toEqual({ ok: true });
    expect(overlay.openCalls).toBe(1);
  });

  it('无学习内容时返回 no-learning-content，并恢复原播放状态', async () => {
    const { controller, adapter, overlay, playback } = makeController({ item: null });
    adapter.setCurrentEvent('bv-1', {});

    const result = await controller.startContinuousLearning();
    await flush();

    expect(result).toEqual({ ok: false, reason: 'no-learning-content' });
    expect(playback.pauseCalls).toBe(1);
    expect(playback.playCalls).toBe(1);
    expect(playback.paused).toBe(false);
    expect(overlay.openCalls).toBe(0);
  });

  it('主动启动时遮罩打开失败会恢复视频并返回 failed', async () => {
    const { controller, adapter, overlay, playback } = makeController();
    adapter.setCurrentEvent('bv-1', {});
    overlay.open = () => {
      throw new Error('模拟遮罩失败');
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await controller.startContinuousLearning();

      expect(result).toEqual({ ok: false, reason: 'failed' });
      expect(playback.pauseCalls).toBe(1);
      expect(playback.playCalls).toBe(1);
      expect(playback.paused).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('主动连续学习后 exit-learning 应用默认冷却并恢复视频', async () => {
    const { controller, adapter, overlay, playback, cooldownStore } = makeController();
    adapter.setCurrentEvent('bv-1', {});

    await controller.startContinuousLearning();
    await flush();

    overlay.fireAction({ type: 'exit-learning' });
    await flush();

    expect(overlay.closeCalls).toBe(1);
    expect(playback.playCalls).toBe(1);
    expect(cooldownStore.current.consecutiveSkipCount).toBe(0);
  });
});

// ─── Issue #12：会话日志记录 ──────────────────────────────────────

describe('ContentController — 会话日志记录（Issue #12）', () => {
  it('单题模式：提交后跳过 → 记录 mode=single, outcome=submitted, questionsAnswered=1', async () => {
    const { adapter, overlay, sessionLogger } = makeController({ withSessionLogger: true });

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({
      type: 'submit-answer',
      question: LEARNING_ITEM.question,
      selectedIndex: 0,
      responseTimeMs: 1500,
    });
    await flush();
    overlay.fireAction({ type: 'skip' });
    await flush();

    expect(sessionLogger).toBeDefined();
    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'single',
      outcome: 'submitted',
      questionsAnswered: 1,
      continuousQuestionsAnswered: 0,
      source: 'natural',
      initialItemKind: 'question',
      initialOutcome: 'submitted',
      startedAt: NOW,
      endedAt: NOW,
    });
  });

  it('单题模式：未提交直接跳过 → 记录 mode=single, outcome=skipped, questionsAnswered=0', async () => {
    const { adapter, overlay, sessionLogger } = makeController({ withSessionLogger: true });

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({ type: 'skip' });
    await flush();

    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'single',
      outcome: 'skipped',
      questionsAnswered: 0,
      source: 'natural',
      initialOutcome: 'skipped',
    });
  });

  it('单题模式：accept-new-word → 记录 mode=single, outcome=submitted, questionsAnswered=0', async () => {
    const { adapter, overlay, sessionLogger } = makeController({ withSessionLogger: true });

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({ type: 'accept-new-word', wordId: 'w-new' });
    await flush();

    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'single',
      outcome: 'submitted',
      questionsAnswered: 0,
      source: 'natural',
      initialOutcome: 'accepted-new',
    });
  });

  it('连续模式：提交并继续后 exit-learning → 记录 mode=continuous, outcome=exit', async () => {
    const { adapter, overlay, sessionLogger } = makeContinuousController({
      items: [LEARNING_ITEM, SPELLING_ITEM],
      withSessionLogger: true,
    });

    adapter.emit('bv-1', {});
    await flush();

    // 提交第一题并继续
    overlay.fireAction({
      type: 'submit-and-continue',
      question: LEARNING_ITEM.question,
      selectedIndex: 0,
      responseTimeMs: 1500,
    });
    await flush();

    // 第二题不提交，直接结束
    overlay.fireAction({ type: 'exit-learning' });
    await flush();

    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'continuous',
      outcome: 'exit',
      questionsAnswered: 1,
      continuousQuestionsAnswered: 0,
      source: 'natural',
      initialOutcome: 'submitted',
    });
  });

  it('连续模式：提交两题后无更多内容自动结束 → 记录 mode=continuous, outcome=submitted, questionsAnswered=2', async () => {
    const { adapter, overlay, sessionLogger } = makeContinuousController({
      items: [LEARNING_ITEM, SPELLING_ITEM],
      withSessionLogger: true,
    });

    adapter.emit('bv-1', {});
    await flush();

    // 提交第一题并继续
    overlay.fireAction({
      type: 'submit-and-continue',
      question: LEARNING_ITEM.question,
      selectedIndex: 0,
      responseTimeMs: 1500,
    });
    await flush();

    // 提交第二题（拼写题）并继续 → 无更多内容 → 自动结束
    overlay.fireAction({
      type: 'submit-spelling-and-continue',
      question: SPELLING_ITEM.question,
      spelledAnswer: 'absorb',
      responseTimeMs: 2000,
    });
    await flush();

    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'continuous',
      outcome: 'submitted',
      questionsAnswered: 2,
      continuousQuestionsAnswered: 1,
      source: 'natural',
      initialOutcome: 'submitted',
    });
  });

  it('主动连续学习后 exit-learning → 记录 mode=continuous, outcome=exit', async () => {
    const { controller, adapter, overlay, sessionLogger } = makeController({
      withSessionLogger: true,
    });
    adapter.setCurrentEvent('bv-1', {});

    await controller.startContinuousLearning();
    await flush();

    overlay.fireAction({ type: 'exit-learning' });
    await flush();

    expect(sessionLogger!.logs).toHaveLength(1);
    expect(sessionLogger!.logs[0]).toMatchObject({
      mode: 'continuous',
      outcome: 'exit',
      questionsAnswered: 0,
    });
  });

  it('未提供 sessionLogger 时不报错', async () => {
    const { adapter, overlay, sessionLogger } = makeController();
    expect(sessionLogger).toBeUndefined();

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({ type: 'skip' });
    await flush();

    // 无 sessionLogger：不报错，正常结束
    expect(overlay.closeCalls).toBe(1);
  });
});

// ─── Issue #19 AC5：会话标识并发唯一 ──────────────────────────────

describe('ContentController — 会话标识并发唯一（Issue #19 AC5）', () => {
  it('两标签同一毫秒、同一内容身份的会话日志 ID 仍各不相同', async () => {
    // 共享会话日志端口与时钟（固定 NOW），模拟两个标签页同时触发同一视频身份。
    // 旧格式 session-${startedAt}-${identity} 在此场景会碰撞为同一 ID。
    const sharedLogger = fakeSessionLogger();
    const clock = { now: () => NOW };

    function buildController() {
      const adapter = fakeAdapter();
      const overlay = fakeOverlay();
      const cooldownStore = fakeCooldownStore();
      const siteState = fakeSiteState(false);
      const playback = fakePlayback({ playing: true });
      const videoPortFor = vi.fn(() => playback);
      const learningService = fakeLearningService(LEARNING_ITEM);
      const controller = new ContentController({
        adapter,
        overlay,
        cooldownStore,
        clock,
        videoPortFor,
        siteState,
        learningService,
        sessionLogger: sharedLogger,
        pauseState: {
          async isGloballyPaused() {
            return false;
          },
        },
      });
      controller.start();
      return { controller, adapter, overlay };
    }

    const tab1 = buildController();
    const tab2 = buildController();

    // 两标签同一毫秒、同一内容身份触发
    tab1.adapter.emit('bv-1', {});
    await flush();
    tab2.adapter.emit('bv-1', {});
    await flush();

    // 两标签各自跳过结束会话
    tab1.overlay.fireAction({ type: 'skip' });
    await flush();
    tab2.overlay.fireAction({ type: 'skip' });
    await flush();

    expect(sharedLogger.logs).toHaveLength(2);
    // 关键：两会话 ID 不同（crypto.randomUUID 保证唯一）
    expect(sharedLogger.logs[0]!.id).not.toBe(sharedLogger.logs[1]!.id);
    // 两会话 startedAt 相同（同一毫秒），但 ID 仍唯一
    expect(sharedLogger.logs[0]!.startedAt).toBe(NOW);
    expect(sharedLogger.logs[1]!.startedAt).toBe(NOW);
  });
});

describe('ContentController — 故障恢复（Issue #13）', () => {
  it('内部恢复不记录为用户跳过，也不更新冷却', async () => {
    const { adapter, overlay, cooldownStore } = makeController();

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({ type: 'recover' });
    await flush();

    expect(overlay.closeCalls).toBe(1);
    expect(cooldownStore.recordCalls).toBe(0);
    expect(cooldownStore.current.consecutiveSkipCount).toBe(0);
  });

  it('自动恢复播放失败时请求一次用户可见提示且不重试', async () => {
    const playback = fakePlayback({ playing: true });
    playback.play = vi.fn(async () => {
      playback.playCalls += 1;
      throw new Error('autoplay blocked');
    });
    const notice = { show: vi.fn(async () => undefined) };
    const { adapter, overlay } = makeController({
      playback,
      playbackRecoveryNotice: notice,
    });

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({ type: 'recover' });
    await flush();

    expect(playback.playCalls).toBe(1);
    expect(notice.show).toHaveBeenCalledTimes(1);
  });

  it('提交失败时关闭遮罩并恢复原本播放的视频', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { adapter, overlay, playback, learningService } = makeController();
    learningService.submitAnswer = async () => {
      throw new Error('模拟存储失败');
    };

    adapter.emit('bv-1', {});
    await flush();
    overlay.fireAction({
      type: 'submit-answer',
      question: LEARNING_ITEM.question,
      selectedIndex: 0,
      responseTimeMs: 1500,
    });
    await flush();

    expect(overlay.closeCalls).toBe(1);
    expect(playback.playCalls).toBe(1);
    // 断言故障日志，避免未断言的错误日志噪声
    expect(errorSpy).toHaveBeenCalledWith(
      '[BingeUp] 学习交互失败，正在返回视频',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

// ─── Issue #24：长视频与直播定时自然触发集成测试 ──────────────────

/**
 * 定时学习集成测试接缝：真实 TimedLearningAdapter 包裹可控的 delegate，
 * 通过 normalizeLearningContext 接入真实 ContentController，覆盖 AC9 全部场景。
 */
function makeTimedController(
  opts: {
    enabled?: boolean;
    intervalMinutes?: number;
    isLive?: boolean;
    duration?: number;
    cooldown?: CooldownState;
    firstPending?: boolean;
    playing?: boolean;
  } = {},
) {
  let now = NOW;
  let intervalHandler: (() => void) | undefined;
  let baseHandler: ((event: VideoChangeEvent) => void) | undefined;
  let settings = {
    longVideoTimedLearningEnabled: opts.enabled ?? false,
    longVideoIntervalMinutes: opts.intervalMinutes ?? 10,
  };
  let hidden = false;
  let isAd = false;
  let currentIdentity = 'bv-1';
  const visibilityHandlers: Array<() => void> = [];

  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', {
    value: opts.duration ?? 60 * 60,
    configurable: true,
  });

  const delegate: VideoSiteAdapter = {
    id: 'timed-test',
    matches: () => true,
    observePageChanges(handler) {
      baseHandler = handler;
      return () => undefined;
    },
    findPrimaryVideo: () => video,
    getVideoIdentity: () => currentIdentity,
    getOverlayTarget: () => video,
    getOverlayMode: () => 'video-region' as OverlayMode,
    isAdvertisement: () => isAd,
    isPreview: () => false,
    isLivePage: () => opts.isLive ?? false,
  };
  const clearIntervalSpy = vi.fn();
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
  const timedAdapter = new TimedLearningAdapter(delegate, {
    settings: { get: async () => settings },
    clock: { now: () => now },
    timers: {
      setInterval(handler) {
        intervalHandler = handler;
        return 7;
      },
      clearInterval: clearIntervalSpy,
    },
    visibility,
  });

  const adapterPort = {
    onVideoChange: (handler: (event: VideoChangeEvent) => void) =>
      timedAdapter.observePageChanges((event) => handler(normalizeLearningContext(event))),
    getCurrentLearningContext(): VideoChangeEvent | null {
      return {
        identity: currentIdentity,
        video,
        overlayTarget: video,
        overlayMode: 'video-region' as OverlayMode,
      };
    },
  };

  const overlay = fakeOverlay();
  const cooldownStore = fakeCooldownStore(opts.cooldown);
  // 让冷却存储使用可变时钟（默认 fakeCooldownStore 使用固定 NOW）
  cooldownStore.recordOutcome = async (outcome: 'submitted' | 'skipped') => {
    cooldownStore.recordCalls += 1;
    cooldownStore.current =
      outcome === 'submitted'
        ? applyComplete(now, CONFIG)
        : applySkip(cooldownStore.current, now, CONFIG);
  };
  const siteState = fakeSiteState(opts.firstPending ?? false);
  const playback = fakePlayback({ playing: opts.playing ?? true });
  const learningService = fakeLearningService(LEARNING_ITEM);

  const controller = new ContentController({
    adapter: adapterPort,
    overlay,
    cooldownStore,
    pauseState: {
      async isGloballyPaused() {
        return false;
      },
    },
    clock: { now: () => now },
    videoPortFor: () => playback,
    siteState,
    learningService,
  });
  controller.start();

  return {
    controller,
    overlay,
    cooldownStore,
    siteState,
    playback,
    learningService,
    clearIntervalSpy,
    emitBase(identity?: string) {
      const id = identity ?? 'bv-1';
      currentIdentity = id;
      baseHandler?.({ identity: id, video, overlayTarget: video, overlayMode: 'video-region' });
    },
    setAd(value: boolean) {
      isAd = value;
    },
    enable(intervalMinutes: number) {
      settings = { longVideoTimedLearningEnabled: true, longVideoIntervalMinutes: intervalMinutes };
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
    advance(milliseconds: number) {
      now += milliseconds;
    },
    now() {
      return now;
    },
    async tick() {
      intervalHandler?.();
      await flush();
    },
    stop() {
      controller.stop();
    },
  };
}

describe('ContentController — 长视频定时学习集成（Issue #24 AC9）', () => {
  it('默认关闭：同一内容身份在冷却结束后不重复弹题', async () => {
    const harness = makeTimedController({ enabled: false });
    harness.emitBase('bv-1');
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 结束首次交互，冷却结束
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    // 经过很长时间，定时学习关闭 → 不再触发
    harness.advance(60 * MS_PER_MIN);
    await harness.tick();

    expect(harness.overlay.openCalls).toBe(1);
  });

  it('开启 10 分钟间隔：到时间在冷却结束后产生新的自然触发点', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 结束交互 → 进入冷却
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    // 冷却设为 5 分钟
    harness.cooldownStore.current.nextAllowedAt = harness.now() + 5 * MS_PER_MIN;

    // 3 分钟后：冷却未结束，不触发
    harness.advance(3 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 再过 7 分钟（共 10 分钟）：冷却已结束 + 间隔已到 → 触发
    harness.advance(7 * MS_PER_MIN);
    await harness.tick();

    expect(harness.overlay.openCalls).toBe(2);
  });

  it('开启 20 分钟间隔：到时间产生新的自然触发点', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 20 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(19 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    harness.advance(1 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('开启 30 分钟间隔：到时间产生新的自然触发点', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 30 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(30 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('直播默认关闭时只在首次进入触发', async () => {
    const harness = makeTimedController({ enabled: false, isLive: true });
    harness.emitBase('live-1');
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    // 直播 + 关闭定时 → 不重复
    for (let i = 0; i < 3; i++) {
      harness.advance(15 * MS_PER_MIN);
      await harness.tick();
    }
    expect(harness.overlay.openCalls).toBe(1);
  });

  it('直播开启定时学习后按间隔重复触发', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10, isLive: true });
    harness.emitBase('live-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);

    // 结束第二次交互
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(3);
  });

  it('冷却未结束时定时触发不打开遮罩', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    // 冷却长于定时间隔
    harness.cooldownStore.current.nextAllowedAt = harness.now() + 30 * MS_PER_MIN;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);
  });

  it('广告状态下定时触发不打开遮罩', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    // 广告开始
    harness.setAd(true);
    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 广告结束 → 下一次检查可触发
    harness.setAd(false);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('页面隐藏时不产生定时触发', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.setHidden(true);
    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 恢复可见后需重新等待完整间隔
    harness.setHidden(false);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('修改间隔后后续触发使用最新设置', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 20 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    // 10 分钟（20 分钟间隔未到）→ 不触发
    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);

    // 改为 10 分钟间隔 → 下一次检查即可触发
    harness.enable(10);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('运行中关闭后不再产生定时触发', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);

    // 关闭
    harness.disable();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(20 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
  });

  it('控制器停止后清理定时调度', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.stop();

    expect(harness.clearIntervalSpy).toHaveBeenCalledWith(7);
    // 停止后即使到时间也不触发
    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(1);
  });

  it('定时交互期间视频保持暂停，结束后恢复原本播放的视频', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10 });
    harness.emitBase('bv-1');
    await harness.tick();
    expect(harness.playback.paused).toBe(true);

    // 定时触发到达
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
    // 第二次交互期间视频暂停
    expect(harness.playback.paused).toBe(true);

    // 结束后恢复播放
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    expect(harness.playback.paused).toBe(false);
  });

  it('定时交互期间原本暂停的视频保持暂停，结束后不恢复播放（AC8）', async () => {
    const harness = makeTimedController({ enabled: true, intervalMinutes: 10, playing: false });
    harness.emitBase('bv-1');
    await harness.tick();
    expect(harness.playback.paused).toBe(true);

    // 定时触发到达
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    harness.cooldownStore.current.nextAllowedAt = 0;

    harness.advance(10 * MS_PER_MIN);
    await harness.tick();
    expect(harness.overlay.openCalls).toBe(2);
    // 第二次交互期间视频保持暂停
    expect(harness.playback.paused).toBe(true);

    // 结束后不恢复播放（原本就是暂停的）
    harness.overlay.fireAction({ type: 'skip' });
    await harness.tick();
    expect(harness.playback.paused).toBe(true);
  });
});
