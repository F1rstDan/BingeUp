import { beforeEach, describe, expect, it } from 'vitest';
import { GenericVideoAdapter } from '@/adapters/generic-video';
import {
  detectSiteCapability,
  findPrimaryVideoGeneric,
  getGenericVideoIdentity,
  isBackgroundVideo,
  isVisibleAndMeaningful,
  scoreVideoCandidate,
  MIN_VIDEO_WIDTH,
  MIN_VIDEO_HEIGHT,
} from '@/adapters/generic-video/detection';
import type { VideoChangeEvent } from '@/types';

// 测试环境 jsdom 的 url 为 https://www.bilibili.com/，不能跨源 pushState。
// 通用适配器不关心具体域名，用同源路径即可。
const GENERIC_PATH = '/test-generic';

function resetPage(): void {
  document.body.innerHTML = '';
  history.pushState({}, '', GENERIC_PATH);
}

function createVideo(
  opts: {
    width?: number;
    height?: number;
    muted?: boolean;
    loop?: boolean;
    paused?: boolean;
    src?: string;
    display?: string;
    visibility?: string;
    opacity?: number;
  } = {},
): HTMLVideoElement {
  const width = opts.width ?? 800;
  const height = opts.height ?? 450;
  const video = document.createElement('video');

  if (opts.muted) video.muted = true;
  if (opts.loop) video.loop = true;
  if (opts.paused === false) {
    // 模拟正在播放：jsdom 不会自动播放，通过 paused=false 标记
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'ended', { value: false, configurable: true });
  }
  if (opts.src) {
    Object.defineProperty(video, 'currentSrc', { value: opts.src, configurable: true });
  }
  if (opts.display) video.style.display = opts.display;
  if (opts.visibility) video.style.visibility = opts.visibility;
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

describe('isVisibleAndMeaningful — 可见性判定', () => {
  beforeEach(() => resetPage());

  it('尺寸足够且可见 → true', () => {
    const video = createVideo({ width: 300, height: 200 });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(true);
  });

  it('宽度不足 → false', () => {
    const video = createVideo({ width: MIN_VIDEO_WIDTH - 1, height: 200 });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(false);
  });

  it('高度不足 → false', () => {
    const video = createVideo({ width: 300, height: MIN_VIDEO_HEIGHT - 1 });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(false);
  });

  it('display:none → false', () => {
    const video = createVideo({ display: 'none' });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(false);
  });

  it('visibility:hidden → false', () => {
    const video = createVideo({ visibility: 'hidden' });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(false);
  });

  it('opacity:0 → false', () => {
    const video = createVideo({ opacity: 0 });
    document.body.appendChild(video);
    expect(isVisibleAndMeaningful(video)).toBe(false);
  });
});

describe('isBackgroundVideo — 背景视频判定', () => {
  it('muted + loop → true', () => {
    const video = createVideo({ muted: true, loop: true });
    expect(isBackgroundVideo(video)).toBe(true);
  });

  it('仅 muted → false', () => {
    const video = createVideo({ muted: true });
    expect(isBackgroundVideo(video)).toBe(false);
  });

  it('仅 loop → false', () => {
    const video = createVideo({ loop: true });
    expect(isBackgroundVideo(video)).toBe(false);
  });

  it('均否 → false', () => {
    const video = createVideo();
    expect(isBackgroundVideo(video)).toBe(false);
  });
});

describe('scoreVideoCandidate — 候选评分', () => {
  it('正在播放的视频分数更高', () => {
    const paused = createVideo({ width: 400, height: 300, paused: true });
    const playing = createVideo({ width: 400, height: 300, paused: false });
    expect(scoreVideoCandidate(playing)).toBeGreaterThan(scoreVideoCandidate(paused));
  });

  it('静音视频分数更低', () => {
    const normal = createVideo({ width: 400, height: 300, muted: false });
    const muted = createVideo({ width: 400, height: 300, muted: true });
    expect(scoreVideoCandidate(muted)).toBeLessThan(scoreVideoCandidate(normal));
  });

  it('面积越大分数越高', () => {
    const small = createVideo({ width: 300, height: 200 });
    const large = createVideo({ width: 800, height: 600 });
    expect(scoreVideoCandidate(large)).toBeGreaterThan(scoreVideoCandidate(small));
  });
});

describe('findPrimaryVideoGeneric — 主视频查找', () => {
  beforeEach(() => resetPage());

  it('无视频 → null', () => {
    expect(findPrimaryVideoGeneric()).toBeNull();
  });

  it('单个可见视频 → 返回该视频', () => {
    const video = createVideo();
    document.body.appendChild(video);
    expect(findPrimaryVideoGeneric()).toBe(video);
  });

  it('多个视频 → 返回评分最高者', () => {
    const small = createVideo({ width: 300, height: 200 });
    const large = createVideo({ width: 800, height: 600 });
    document.body.appendChild(small);
    document.body.appendChild(large);
    expect(findPrimaryVideoGeneric()).toBe(large);
  });

  it('过滤背景视频（muted + loop）', () => {
    const bg = createVideo({ muted: true, loop: true, width: 800, height: 600 });
    const normal = createVideo({ width: 400, height: 300 });
    document.body.appendChild(bg);
    document.body.appendChild(normal);
    expect(findPrimaryVideoGeneric()).toBe(normal);
  });

  it('过滤不可见视频', () => {
    const hidden = createVideo({ display: 'none', width: 800, height: 600 });
    const visible = createVideo({ width: 400, height: 300 });
    document.body.appendChild(hidden);
    document.body.appendChild(visible);
    expect(findPrimaryVideoGeneric()).toBe(visible);
  });

  it('全部不可见 → null', () => {
    const hidden = createVideo({ display: 'none' });
    document.body.appendChild(hidden);
    expect(findPrimaryVideoGeneric()).toBeNull();
  });
});

describe('getGenericVideoIdentity — 身份标识', () => {
  it('有 currentSrc → generic:src', () => {
    const video = createVideo({ src: 'https://example.com/video.mp4' });
    expect(getGenericVideoIdentity(video)).toBe('generic:https://example.com/video.mp4');
  });

  it('无 src 但有尺寸 → generic:WxH@L,T', () => {
    const video = createVideo({ width: 400, height: 300 });
    // 重写 currentSrc 和 src 为空
    Object.defineProperty(video, 'currentSrc', { value: '', configurable: true });
    Object.defineProperty(video, 'src', { value: '', configurable: true });
    expect(getGenericVideoIdentity(video)).toBe('generic:400x300@0,0');
  });

  it('无 src 且零尺寸 → null', () => {
    const video = createVideo({ width: 0, height: 0 });
    Object.defineProperty(video, 'currentSrc', { value: '', configurable: true });
    Object.defineProperty(video, 'src', { value: '', configurable: true });
    expect(getGenericVideoIdentity(video)).toBeNull();
  });
});

describe('detectSiteCapability — 能力检测（AC2 / AC4）', () => {
  beforeEach(() => resetPage());

  it('有可靠视频 → generic-video', () => {
    const video = createVideo();
    document.body.appendChild(video);
    expect(detectSiteCapability()).toBe('generic-video');
  });

  it('无视频 → basic-web', () => {
    expect(detectSiteCapability()).toBe('basic-web');
  });

  it('仅背景视频 → basic-web（过滤后无可靠视频）', () => {
    const bg = createVideo({ muted: true, loop: true });
    document.body.appendChild(bg);
    expect(detectSiteCapability()).toBe('basic-web');
  });
});

describe('GenericVideoAdapter — 适配器接口', () => {
  beforeEach(() => resetPage());

  it('id 为 generic-video', () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.id).toBe('generic-video');
  });

  it('matches 匹配 HTTPS', () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.matches({ protocol: 'https:' } as Location)).toBe(true);
  });

  it('matches 匹配 HTTP', () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.matches({ protocol: 'http:' } as Location)).toBe(true);
  });

  it('getOverlayMode 返回 full-page（AC2）', () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.getOverlayMode()).toBe('full-page');
  });

  it('isAdvertisement 始终 false（通用模式不过滤广告）', () => {
    const adapter = new GenericVideoAdapter();
    const video = createVideo();
    expect(adapter.isAdvertisement(video)).toBe(false);
  });

  it('isLivePage 始终 false', () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.isLivePage()).toBe(false);
  });

  it('findPrimaryVideo 返回最大可见视频', () => {
    const adapter = new GenericVideoAdapter();
    const small = createVideo({ width: 300, height: 200 });
    const large = createVideo({ width: 800, height: 600 });
    document.body.appendChild(small);
    document.body.appendChild(large);
    expect(adapter.findPrimaryVideo()).toBe(large);
  });

  it('getOverlayTarget 返回视频矩形', () => {
    const adapter = new GenericVideoAdapter();
    const video = createVideo({ width: 400, height: 300 });
    const target = adapter.getOverlayTarget(video);
    expect(target).not.toBeNull();
    expect((target as DOMRect).width).toBe(400);
    expect((target as DOMRect).height).toBe(300);
  });

  it('isPreview 尺寸过小 → true', () => {
    const adapter = new GenericVideoAdapter();
    const small = createVideo({ width: 100, height: 80 });
    expect(adapter.isPreview(small)).toBe(true);
  });

  it('isPreview 尺寸足够 → false', () => {
    const adapter = new GenericVideoAdapter();
    const normal = createVideo({ width: 400, height: 300 });
    expect(adapter.isPreview(normal)).toBe(false);
  });
});

describe('GenericVideoAdapter — observePageChanges', () => {
  beforeEach(() => resetPage());

  it('检测到视频后发出 VideoChangeEvent', () => {
    const adapter = new GenericVideoAdapter();
    const video = createVideo({ src: 'https://example.com/v.mp4' });
    document.body.appendChild(video);

    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events).toHaveLength(1);
    expect(events[0]!.video).toBe(video);
    expect(events[0]!.overlayMode).toBe('full-page');
    expect(events[0]!.identity).toBe('generic:https://example.com/v.mp4');
  });

  it('同一身份不重复发出事件', () => {
    const adapter = new GenericVideoAdapter();
    const video = createVideo({ src: 'https://example.com/v.mp4' });
    document.body.appendChild(video);

    const events: VideoChangeEvent[] = [];
    const stop = adapter.observePageChanges((event) => events.push(event));
    expect(events).toHaveLength(1);

    // 再次检测同一视频：不应发出新事件
    const video2 = createVideo({ src: 'https://example.com/v.mp4' });
    document.body.removeChild(video);
    document.body.appendChild(video2);

    expect(events).toHaveLength(1);
    stop();
  });

  it('无视频时不发出事件', () => {
    const adapter = new GenericVideoAdapter();
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));
    expect(events).toHaveLength(0);
  });

  it('cleanup 停止后不再发出事件', () => {
    const adapter = new GenericVideoAdapter();
    const events: VideoChangeEvent[] = [];
    const stop = adapter.observePageChanges((event) => events.push(event));
    stop();

    const video = createVideo({ src: 'https://example.com/v.mp4' });
    document.body.appendChild(video);

    // 给 MutationObserver 一点时间（不应触发）
    expect(events).toHaveLength(0);
  });
});
