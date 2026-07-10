import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BilibiliAdapter, getBilibiliVideoIdentity } from '@/adapters/bilibili';
import type { VideoChangeEvent } from '@/types';

const BILIBILI_ORIGIN = 'https://www.bilibili.com';

/** 刷新到首页，清空 DOM，重置导航历史。 */
function resetPage(): void {
  document.body.innerHTML = '';
  history.pushState({}, '', `${BILIBILI_ORIGIN}/`);
}

/** 刷新 MutationObserver 回调（微任务 + 宏任务）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 导航到指定 Bilibili 路径。 */
function navigateTo(path: string): void {
  history.pushState({}, '', `${BILIBILI_ORIGIN}${path}`);
}

interface VideoOpts {
  width?: number;
  height?: number;
  muted?: boolean;
  loop?: boolean;
  className?: string;
  display?: string;
  opacity?: number;
}

/**
 * 创建带 mock 尺寸的 <video> 元素。
 * jsdom 不做布局，getBoundingClientRect 返回全零，需要 mock 才能测试可见性过滤。
 */
function createVideo(opts: VideoOpts = {}): HTMLVideoElement {
  const width = opts.width ?? 800;
  const height = opts.height ?? 450;
  const video = document.createElement('video');

  if (opts.muted) video.muted = true;
  if (opts.loop) video.loop = true;
  if (opts.className) video.className = opts.className;
  if (opts.display) video.style.display = opts.display;
  video.style.opacity = String(opts.opacity ?? 1);

  video.getBoundingClientRect = () => ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return video;
}

/** 把视频放进带 class 的容器并挂到 body。 */
function mountInContainer(video: HTMLVideoElement, containerClass: string): HTMLElement {
  const container = document.createElement('div');
  container.className = containerClass;
  container.appendChild(video);
  document.body.appendChild(container);
  return container;
}

describe('getBilibiliVideoIdentity — 身份提取', () => {
  it('普通视频 /video/BVxxx → BV 大写', () => {
    expect(getBilibiliVideoIdentity(`${BILIBILI_ORIGIN}/video/BV1abc12345`)).toBe('BV1ABC12345');
  });

  it('竖屏视频 /v/BVxxx → BV 大写', () => {
    expect(getBilibiliVideoIdentity(`${BILIBILI_ORIGIN}/v/BV2def67890`)).toBe('BV2DEF67890');
  });

  it('直播 /live/12345 → live-12345', () => {
    expect(getBilibiliVideoIdentity(`${BILIBILI_ORIGIN}/live/12345`)).toBe('live-12345');
  });

  it('直播 live.bilibili.com/12345 → live-12345', () => {
    expect(getBilibiliVideoIdentity(`https://live.bilibili.com/12345`)).toBe('live-12345');
  });

  it('非视频页 → null', () => {
    expect(getBilibiliVideoIdentity(`${BILIBILI_ORIGIN}/`)).toBeNull();
    expect(getBilibiliVideoIdentity(`${BILIBILI_ORIGIN}/channel/webhome`)).toBeNull();
  });
});

describe('BilibiliAdapter.matches', () => {
  const adapter = new BilibiliAdapter();

  it('www.bilibili.com 匹配', () => {
    expect(adapter.matches({ hostname: 'www.bilibili.com' } as Location)).toBe(true);
  });

  it('live.bilibili.com 匹配', () => {
    expect(adapter.matches({ hostname: 'live.bilibili.com' } as Location)).toBe(true);
  });

  it('m.bilibili.com 匹配', () => {
    expect(adapter.matches({ hostname: 'm.bilibili.com' } as Location)).toBe(true);
  });

  it('youtube.com 不匹配', () => {
    expect(adapter.matches({ hostname: 'www.youtube.com' } as Location)).toBe(false);
  });
});

describe('BilibiliAdapter.findPrimaryVideo — 主播放器选择与过滤', () => {
  beforeEach(() => resetPage());

  it('单个大视频 → 返回该视频', () => {
    const video = createVideo({ width: 800, height: 450 });
    document.body.appendChild(video);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBe(video);
  });

  it('多个视频 → 返回面积最大的可见视频', () => {
    const small = createVideo({ width: 300, height: 200 });
    const large = createVideo({ width: 960, height: 540 });
    document.body.append(small, large);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBe(large);
  });

  it('不可见视频（display:none）→ 不被选中', () => {
    const hidden = createVideo({ width: 960, height: 540, display: 'none' });
    const visible = createVideo({ width: 400, height: 300 });
    document.body.append(hidden, visible);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBe(visible);
  });

  it('透明视频（opacity:0）→ 不被选中', () => {
    const transparent = createVideo({ width: 960, height: 540, opacity: 0 });
    const opaque = createVideo({ width: 400, height: 300 });
    document.body.append(transparent, opaque);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBe(opaque);
  });

  it('过小视频（< 200×120）→ 不被选中', () => {
    const tiny = createVideo({ width: 100, height: 80 });
    document.body.appendChild(tiny);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });

  it('背景视频（muted+loop）→ 不被选中', () => {
    const bg = createVideo({ width: 800, height: 450, muted: true, loop: true });
    document.body.appendChild(bg);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });

  it('背景视频与主视频并存 → 只返回主视频', () => {
    const bg = createVideo({ width: 1200, height: 700, muted: true, loop: true });
    const main = createVideo({ width: 960, height: 540 });
    document.body.append(bg, main);
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBe(main);
  });

  it('无视频 → 返回 null', () => {
    const adapter = new BilibiliAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });
});

describe('BilibiliAdapter — 广告/预览/直播识别', () => {
  beforeEach(() => resetPage());

  it('广告视频（在 .bpx-player-ad-wrap 内）→ isAdvertisement=true', () => {
    const video = createVideo();
    mountInContainer(video, 'bpx-player-ad-wrap');
    const adapter = new BilibiliAdapter();

    expect(adapter.isAdvertisement(video)).toBe(true);
  });

  it('普通视频 → isAdvertisement=false', () => {
    const video = createVideo();
    mountInContainer(video, 'bpx-player-video-wrap');
    const adapter = new BilibiliAdapter();

    expect(adapter.isAdvertisement(video)).toBe(false);
  });

  it('预览视频（在 .video-card 内）→ isPreview=true', () => {
    const video = createVideo({ width: 100, height: 80 });
    mountInContainer(video, 'video-card');
    const adapter = new BilibiliAdapter();

    expect(adapter.isPreview(video)).toBe(true);
  });

  it('普通主视频 → isPreview=false', () => {
    const video = createVideo({ width: 800, height: 450 });
    mountInContainer(video, 'bpx-player-video-wrap');
    const adapter = new BilibiliAdapter();

    expect(adapter.isPreview(video)).toBe(false);
  });

  it('直播页 → isLivePage=true', () => {
    navigateTo('/live/12345');
    const adapter = new BilibiliAdapter();

    expect(adapter.isLivePage()).toBe(true);
  });

  it('普通视频页 → isLivePage=false', () => {
    navigateTo('/video/BV1test');
    const adapter = new BilibiliAdapter();

    expect(adapter.isLivePage()).toBe(false);
  });
});

describe('BilibiliAdapter.observePageChanges — 视频变化检测', () => {
  let cleanup: (() => void) | null = null;
  const events: VideoChangeEvent[] = [];

  beforeEach(() => {
    resetPage();
    events.length = 0;
    cleanup = null;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  function startObserver(adapter = new BilibiliAdapter()): BilibiliAdapter {
    cleanup = adapter.observePageChanges((event) => {
      events.push(event);
    });
    return adapter;
  }

  describe('普通视频、竖屏视频与站内切换', () => {
    it('普通视频页刷新 → 发出 BV 身份事件', () => {
      navigateTo('/video/BV1abc');
      const video = createVideo({ width: 800, height: 450 });
      mountInContainer(video, 'bpx-player-container');
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV1ABC');
      expect(events[0]?.video).toBe(video);
      expect(events[0]?.overlayMode).toBe('video-region');
    });

    it('竖屏视频页刷新 → 发出 BV 身份事件', () => {
      navigateTo('/v/BV2def');
      const video = createVideo({ width: 360, height: 640 });
      document.body.appendChild(video);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV2DEF');
    });

    it('站内 SPA 切换到新视频 → 发出新 BV 身份', async () => {
      navigateTo('/video/BV1aaa');
      const video1 = createVideo({ width: 800, height: 450 });
      document.body.appendChild(video1);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV1AAA');

      // SPA 导航：URL 变化 + 视频元素替换
      navigateTo('/video/BV2bbb');
      video1.remove();
      document.body.appendChild(createVideo({ width: 800, height: 450 }));
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('BV2BBB');
    });

    it('仅 URL 变化、视频元素复用 → 发出新 BV 身份', async () => {
      // Bilibili SPA 路由切换有时只改 URL，复用同一 <video> 元素（换 src）。
      // 仅依赖 MutationObserver 会漏检；必须钩 history API。
      navigateTo('/video/BV1url');
      const video = createVideo({ width: 800, height: 450 });
      document.body.appendChild(video);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV1URL');

      navigateTo('/video/BV2url');
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('BV2URL');
    });

    it('多个视频只对主播放器触发一次', () => {
      navigateTo('/video/BV1mp1');
      const main = createVideo({ width: 960, height: 540 });
      const secondary = createVideo({ width: 300, height: 200 });
      document.body.append(main, secondary);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV1MP1');
      expect(events[0]?.video).toBe(main);
    });
  });

  describe('广告、预览、缩略图、背景视频不触发', () => {
    it('广告视频 → 不发出事件', () => {
      navigateTo('/video/BV1ad1');
      const adVideo = createVideo({ width: 800, height: 450 });
      mountInContainer(adVideo, 'bpx-player-ad-wrap');
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('悬停预览视频（小尺寸 + .video-card）→ 不发出事件', () => {
      navigateTo('/video/BV1pv1');
      const main = createVideo({ width: 800, height: 450 });
      document.body.appendChild(main);
      startObserver();
      expect(events).toHaveLength(1);

      // 推荐区出现悬停预览（小尺寸），不应触发新事件
      const previewVideo = createVideo({ width: 100, height: 80 });
      mountInContainer(previewVideo, 'video-card');
      void flush();

      expect(events).toHaveLength(1);
    });

    it('页面仅有预览视频 → 不发出事件', () => {
      navigateTo('/video/BV1pv2');
      const previewVideo = createVideo({ width: 800, height: 450 });
      mountInContainer(previewVideo, 'video-card');
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('背景视频（muted+loop）→ 不发出事件', () => {
      navigateTo('/video/BV1bg1');
      const bg = createVideo({ width: 800, height: 450, muted: true, loop: true });
      document.body.appendChild(bg);
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('无视频页面 → 不发出事件', async () => {
      navigateTo('/video/BV1nv1');
      startObserver();

      expect(events).toHaveLength(0);

      // 后续出现视频 → 发出事件
      document.body.appendChild(createVideo({ width: 800, height: 450 }));
      await flush();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('BV1NV1');
    });
  });

  describe('直播首次触发至多一次', () => {
    it('直播页首次进入 → 发出 live 身份事件，仅一次', async () => {
      navigateTo('/live/12345');
      document.body.appendChild(createVideo({ width: 800, height: 450 }));
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('live-12345');

      // DOM 变动（如播放器布局更新）不重复触发
      document.body.appendChild(createVideo({ width: 800, height: 450 }));
      await flush();

      expect(events).toHaveLength(1);
    });
  });

  describe('播放器控制栏或布局更新不重复触发', () => {
    it('控制栏 DOM 更新 → 同一视频不重复发出事件', async () => {
      navigateTo('/video/BV1cb1');
      const playerWrap = mountInContainer(
        createVideo({ width: 800, height: 450 }),
        'bpx-player-container',
      );
      startObserver();

      expect(events).toHaveLength(1);

      // 模拟播放器控制栏异步加载
      const controls = document.createElement('div');
      controls.className = 'bpx-player-control-bottom';
      playerWrap.appendChild(controls);
      await flush();

      expect(events).toHaveLength(1);
    });

    it('视频元素被替换为同尺寸新元素但 URL 不变 → 不重复发出事件', async () => {
      navigateTo('/video/BV1cb2');
      const video1 = createVideo({ width: 800, height: 450 });
      document.body.appendChild(video1);
      startObserver();

      expect(events).toHaveLength(1);

      // 播放器重建 video 元素，但 URL（identity）未变
      video1.remove();
      document.body.appendChild(createVideo({ width: 800, height: 450 }));
      await flush();

      expect(events).toHaveLength(1);
    });
  });

  describe('遮罩目标', () => {
    it('视频在播放器容器内 → getOverlayTarget 返回容器', () => {
      const video = createVideo();
      const container = mountInContainer(video, 'bpx-player-container');
      const adapter = new BilibiliAdapter();

      expect(adapter.getOverlayTarget(video)).toBe(container);
    });

    it('视频无播放器容器 → getOverlayTarget 回退到视频矩形', () => {
      const video = createVideo();
      document.body.appendChild(video);
      const adapter = new BilibiliAdapter();

      const target = adapter.getOverlayTarget(video);
      expect(target).not.toBeInstanceOf(HTMLElement);
      // getBoundingClientRect 每次返回新对象，比较关键字段
      expect((target as DOMRect).width).toBe(800);
      expect((target as DOMRect).height).toBe(450);
    });
  });
});
