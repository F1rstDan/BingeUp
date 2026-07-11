import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YouTubeAdapter, getYouTubeVideoIdentity } from '@/adapters/youtube';
import type { VideoChangeEvent } from '@/types';

/**
 * jsdom 环境默认 origin 为 bilibili（见 vitest.config.ts）。
 * YouTube 身份识别基于路径与查询参数（/watch?v=、/shorts/、/live/），
 * 与 origin 无关，因此使用相对 URL 导航即可保持测试真实性，又避免跨源 pushState 被拒。
 */
const YT_ORIGIN = 'https://www.youtube.com';

/** 刷新到首页，清空 DOM，重置导航历史。 */
function resetPage(): void {
  document.body.innerHTML = '';
  history.pushState({}, '', '/');
}

/** 刷新 MutationObserver 回调（微任务 + 宏任务）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 导航到指定 YouTube 路径（相对 URL，保持同源）。 */
function navigateTo(path: string): void {
  history.pushState({}, '', path);
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
  const width = opts.width ?? 854;
  const height = opts.height ?? 480;
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

/**
 * 把视频放进指定标签名的自定义元素并挂到 body。
 * YouTube 使用自定义元素（如 <ytd-rich-item-renderer>）作为容器，而非带 class 的 div。
 */
function mountInCustomTag(video: HTMLVideoElement, tagName: string): HTMLElement {
  const container = document.createElement(tagName);
  container.appendChild(video);
  document.body.appendChild(container);
  return container;
}

describe('getYouTubeVideoIdentity — 身份提取', () => {
  it('普通视频 /watch?v=ID → yt:watch:ID', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/watch?v=dQw4w9WgXcQ`)).toBe('yt:watch:dQw4w9WgXcQ');
  });

  it('普通视频带额外参数 → 仍按 v 参数提取', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/watch?v=abc12345678&t=120s`)).toBe('yt:watch:abc12345678');
  });

  it('Shorts /shorts/ID → yt:shorts:ID', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/shorts/abcdef12345`)).toBe('yt:shorts:abcdef12345');
  });

  it('直播 /live/ID → yt:live:ID', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/live/jNQXAC9IVRw`)).toBe('yt:live:jNQXAC9IVRw');
  });

  it('首页 / feed / channel → null', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/`)).toBeNull();
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/feed/trending`)).toBeNull();
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/c/somechannel`)).toBeNull();
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/@somecreator`)).toBeNull();
  });

  it('watch 缺少 v 参数 → null', () => {
    expect(getYouTubeVideoIdentity(`${YT_ORIGIN}/watch?t=120s`)).toBeNull();
  });
});

describe('YouTubeAdapter.matches', () => {
  const adapter = new YouTubeAdapter();

  it('www.youtube.com 匹配', () => {
    expect(adapter.matches({ hostname: 'www.youtube.com' } as Location)).toBe(true);
  });

  it('m.youtube.com 匹配', () => {
    expect(adapter.matches({ hostname: 'm.youtube.com' } as Location)).toBe(true);
  });

  it('music.youtube.com 不匹配（Beta 仅支持普通视频与 Shorts）', () => {
    expect(adapter.matches({ hostname: 'music.youtube.com' } as Location)).toBe(false);
  });

  it('bilibili.com 不匹配', () => {
    expect(adapter.matches({ hostname: 'www.bilibili.com' } as Location)).toBe(false);
  });
});

describe('YouTubeAdapter.findPrimaryVideo — 主播放器选择与过滤', () => {
  beforeEach(() => resetPage());

  it('单个大视频 → 返回该视频', () => {
    const video = createVideo({ width: 854, height: 480 });
    document.body.appendChild(video);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBe(video);
  });

  it('多个视频 → 返回面积最大的可见视频', () => {
    const small = createVideo({ width: 320, height: 180 });
    const large = createVideo({ width: 1280, height: 720 });
    document.body.append(small, large);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBe(large);
  });

  it('不可见视频（display:none）→ 不被选中', () => {
    const hidden = createVideo({ width: 1280, height: 720, display: 'none' });
    const visible = createVideo({ width: 640, height: 360 });
    document.body.append(hidden, visible);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBe(visible);
  });

  it('透明视频（opacity:0）→ 不被选中', () => {
    const transparent = createVideo({ width: 1280, height: 720, opacity: 0 });
    const opaque = createVideo({ width: 640, height: 360 });
    document.body.append(transparent, opaque);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBe(opaque);
  });

  it('过小视频（< 200×120）→ 不被选中', () => {
    const tiny = createVideo({ width: 100, height: 80 });
    document.body.appendChild(tiny);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });

  it('背景视频（muted+loop）→ 不被选中', () => {
    const bg = createVideo({ width: 854, height: 480, muted: true, loop: true });
    document.body.appendChild(bg);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });

  it('背景视频与主视频并存 → 只返回主视频', () => {
    const bg = createVideo({ width: 1280, height: 720, muted: true, loop: true });
    const main = createVideo({ width: 960, height: 540 });
    document.body.append(bg, main);
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBe(main);
  });

  it('无视频 → 返回 null', () => {
    const adapter = new YouTubeAdapter();

    expect(adapter.findPrimaryVideo()).toBeNull();
  });
});

describe('YouTubeAdapter — 广告/预览/直播识别', () => {
  beforeEach(() => resetPage());

  it('广告视频（#movie_player 带 .ad-showing）→ isAdvertisement=true', () => {
    const video = createVideo();
    const player = mountInContainer(video, 'ad-showing');
    player.id = 'movie_player';
    const adapter = new YouTubeAdapter();

    expect(adapter.isAdvertisement(video)).toBe(true);
  });

  it('广告视频（存在 .ytp-ad-player-overlay）→ isAdvertisement=true', () => {
    const video = createVideo();
    const player = mountInContainer(video, '');
    player.id = 'movie_player';
    const overlay = document.createElement('div');
    overlay.className = 'ytp-ad-player-overlay';
    player.appendChild(overlay);
    const adapter = new YouTubeAdapter();

    expect(adapter.isAdvertisement(video)).toBe(true);
  });

  it('普通主视频 → isAdvertisement=false', () => {
    const video = createVideo();
    const player = mountInContainer(video, '');
    player.id = 'movie_player';
    const adapter = new YouTubeAdapter();

    expect(adapter.isAdvertisement(video)).toBe(false);
  });

  it('预览视频（在 ytd-rich-item-renderer 内）→ isPreview=true', () => {
    const video = createVideo({ width: 100, height: 80 });
    mountInCustomTag(video, 'ytd-rich-item-renderer');
    const adapter = new YouTubeAdapter();

    expect(adapter.isPreview(video)).toBe(true);
  });

  it('预览视频（在 ytd-video-preview 内）→ isPreview=true', () => {
    const video = createVideo({ width: 100, height: 80 });
    mountInCustomTag(video, 'ytd-video-preview');
    const adapter = new YouTubeAdapter();

    expect(adapter.isPreview(video)).toBe(true);
  });

  it('普通主视频 → isPreview=false', () => {
    const video = createVideo({ width: 854, height: 480 });
    const player = mountInContainer(video, '');
    player.id = 'movie_player';
    const adapter = new YouTubeAdapter();

    expect(adapter.isPreview(video)).toBe(false);
  });

  it('直播页 /live/ID → isLivePage=true', () => {
    navigateTo('/live/jNQXAC9IVRw');
    const adapter = new YouTubeAdapter();

    expect(adapter.isLivePage()).toBe(true);
  });

  it('普通视频页 → isLivePage=false', () => {
    navigateTo('/watch?v=dQw4w9WgXcQ');
    const adapter = new YouTubeAdapter();

    expect(adapter.isLivePage()).toBe(false);
  });
});

describe('YouTubeAdapter.observePageChanges — 视频变化检测', () => {
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

  function startObserver(adapter = new YouTubeAdapter()): YouTubeAdapter {
    cleanup = adapter.observePageChanges((event) => {
      events.push(event);
    });
    return adapter;
  }

  describe('普通视频、Shorts 与 SPA 切换', () => {
    it('普通视频页刷新 → 发出 yt:watch:ID 事件', () => {
      navigateTo('/watch?v=dQw4w9WgXcQ');
      const video = createVideo({ width: 854, height: 480 });
      const player = mountInContainer(video, '');
      player.id = 'movie_player';
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:dQw4w9WgXcQ');
      expect(events[0]?.video).toBe(video);
      expect(events[0]?.overlayMode).toBe('video-region');
    });

    it('Shorts 页刷新 → 发出 yt:shorts:ID 事件', () => {
      navigateTo('/shorts/abcdef12345');
      const video = createVideo({ width: 360, height: 640 });
      const player = mountInContainer(video, '');
      player.id = 'shorts-player';
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:shorts:abcdef12345');
    });

    it('Shorts 上下滑动到新视频 → 发出新 yt:shorts:ID', async () => {
      navigateTo('/shorts/aaaa1111111');
      const video1 = createVideo({ width: 360, height: 640 });
      const player1 = mountInContainer(video1, '');
      player1.id = 'shorts-player';
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:shorts:aaaa1111111');

      // Shorts 滑动：URL 变化 + 视频元素替换
      navigateTo('/shorts/bbbb2222222');
      video1.remove();
      const player2 = mountInContainer(createVideo({ width: 360, height: 640 }), '');
      player2.id = 'shorts-player';
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('yt:shorts:bbbb2222222');
    });

    it('SPA 从 watch 切换到新 watch → 发出新 yt:watch:ID', async () => {
      navigateTo('/watch?v=vid00000001');
      const video1 = createVideo({ width: 854, height: 480 });
      document.body.appendChild(video1);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:vid00000001');

      navigateTo('/watch?v=vid00000002');
      video1.remove();
      document.body.appendChild(createVideo({ width: 854, height: 480 }));
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('yt:watch:vid00000002');
    });

    it('仅 URL 变化、视频元素复用 → 仍发出新身份', async () => {
      // YouTube SPA 路由切换有时只改 URL，复用同一 <video> 元素（换 src）。
      // 仅依赖 MutationObserver 会漏检；必须钩 history API。
      navigateTo('/watch?v=urlreuse1aa');
      const video = createVideo({ width: 854, height: 480 });
      document.body.appendChild(video);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:urlreuse1aa');

      navigateTo('/watch?v=urlreuse2bb');
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('yt:watch:urlreuse2bb');
    });

    it('从 watch 切换到 shorts（表面变化）→ 发出新身份', async () => {
      navigateTo('/watch?v=surfacex01');
      const video1 = createVideo({ width: 854, height: 480 });
      document.body.appendChild(video1);
      startObserver();

      expect(events).toHaveLength(1);

      navigateTo('/shorts/surfacex02');
      await flush();

      expect(events).toHaveLength(2);
      expect(events[1]?.identity).toBe('yt:shorts:surfacex02');
    });

    it('多个视频只对主播放器触发一次', () => {
      navigateTo('/watch?v=multi0000011');
      const main = createVideo({ width: 1280, height: 720 });
      const secondary = createVideo({ width: 320, height: 180 });
      document.body.append(main, secondary);
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:multi0000011');
      expect(events[0]?.video).toBe(main);
    });
  });

  describe('广告、预览、缩略图、背景视频不触发', () => {
    it('广告视频（#movie_player.ad-showing）→ 不发出事件', () => {
      navigateTo('/watch?v=advtest00001');
      const adVideo = createVideo({ width: 854, height: 480 });
      const player = mountInContainer(adVideo, 'ad-showing');
      player.id = 'movie_player';
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('广告结束后真实视频出现 → 发出一次事件', async () => {
      navigateTo('/watch?v=advtoReal001');
      const adVideo = createVideo({ width: 854, height: 480 });
      const player = mountInContainer(adVideo, 'ad-showing');
      player.id = 'movie_player';
      // 广告期间存在广告覆盖层（真实 YouTube 行为）
      const adOverlay = document.createElement('div');
      adOverlay.className = 'ytp-ad-player-overlay';
      player.appendChild(adOverlay);
      startObserver();

      expect(events).toHaveLength(0);

      // 广告结束：移除广告覆盖层子元素（触发 childList 变更）并清除 .ad-showing
      adOverlay.remove();
      player.classList.remove('ad-showing');
      await flush();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:advtoReal001');
    });

    it('悬停预览视频（小尺寸 + ytd-rich-item-renderer）→ 不发出事件', () => {
      navigateTo('/watch?v=previewtest1');
      const main = createVideo({ width: 854, height: 480 });
      document.body.appendChild(main);
      startObserver();

      expect(events).toHaveLength(1);

      // 推荐区出现悬停预览（小尺寸），不应触发新事件
      const previewVideo = createVideo({ width: 100, height: 80 });
      mountInCustomTag(previewVideo, 'ytd-rich-item-renderer');
      void flush();

      expect(events).toHaveLength(1);
    });

    it('页面仅有预览视频 → 不发出事件', () => {
      navigateTo('/watch?v=previewonly1');
      const previewVideo = createVideo({ width: 854, height: 480 });
      mountInCustomTag(previewVideo, 'ytd-rich-item-renderer');
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('背景视频（muted+loop）→ 不发出事件', () => {
      navigateTo('/watch?v=bgvid0000001');
      const bg = createVideo({ width: 854, height: 480, muted: true, loop: true });
      document.body.appendChild(bg);
      startObserver();

      expect(events).toHaveLength(0);
    });

    it('无视频页面 → 不发出事件', async () => {
      navigateTo('/watch?v=novideo00001');
      startObserver();

      expect(events).toHaveLength(0);

      // 后续出现视频 → 发出事件
      document.body.appendChild(createVideo({ width: 854, height: 480 }));
      await flush();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:watch:novideo00001');
    });
  });

  describe('直播首次触发至多一次', () => {
    it('直播页首次进入 → 发出 live 身份事件，仅一次', async () => {
      navigateTo('/live/livestream01');
      document.body.appendChild(createVideo({ width: 854, height: 480 }));
      startObserver();

      expect(events).toHaveLength(1);
      expect(events[0]?.identity).toBe('yt:live:livestream01');

      // DOM 变动（如播放器布局更新）不重复触发
      document.body.appendChild(createVideo({ width: 854, height: 480 }));
      await flush();

      expect(events).toHaveLength(1);
    });
  });

  describe('播放器控制栏或布局更新不重复触发', () => {
    it('控制栏 DOM 更新 → 同一视频不重复发出事件', async () => {
      navigateTo('/watch?v=ctrlbar00001');
      const player = mountInContainer(createVideo({ width: 854, height: 480 }), '');
      player.id = 'movie_player';
      startObserver();

      expect(events).toHaveLength(1);

      // 模拟播放器控制栏异步加载
      const controls = document.createElement('div');
      controls.className = 'ytp-chrome-bottom';
      player.appendChild(controls);
      await flush();

      expect(events).toHaveLength(1);
    });

    it('视频元素被替换为同尺寸新元素但 URL 不变 → 不重复发出事件', async () => {
      navigateTo('/watch?v=replace00001');
      const video1 = createVideo({ width: 854, height: 480 });
      document.body.appendChild(video1);
      startObserver();

      expect(events).toHaveLength(1);

      // 播放器重建 video 元素，但 URL（identity）未变
      video1.remove();
      document.body.appendChild(createVideo({ width: 854, height: 480 }));
      await flush();

      expect(events).toHaveLength(1);
    });
  });

  describe('遮罩目标', () => {
    it('视频在 #movie_player 内 → getOverlayTarget 返回 #movie_player', () => {
      const video = createVideo();
      const player = mountInContainer(video, '');
      player.id = 'movie_player';
      const adapter = new YouTubeAdapter();

      expect(adapter.getOverlayTarget(video)).toBe(player);
    });

    it('视频在 #shorts-player 内 → getOverlayTarget 返回 #shorts-player', () => {
      const video = createVideo();
      const player = mountInContainer(video, '');
      player.id = 'shorts-player';
      const adapter = new YouTubeAdapter();

      expect(adapter.getOverlayTarget(video)).toBe(player);
    });

    it('视频无播放器容器 → getOverlayTarget 回退到视频矩形', () => {
      const video = createVideo();
      document.body.appendChild(video);
      const adapter = new YouTubeAdapter();

      const target = adapter.getOverlayTarget(video);
      expect(target).not.toBeInstanceOf(HTMLElement);
      expect((target as DOMRect).width).toBe(854);
      expect((target as DOMRect).height).toBe(480);
    });
  });
});
