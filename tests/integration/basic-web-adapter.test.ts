import { beforeEach, describe, expect, it } from 'vitest';
import { BasicWebAdapter } from '@/adapters/basic-web';
import { SCROLL_TRIGGER_THRESHOLD_PX } from '@/adapters/generic-video/detection';
import type { VideoChangeEvent } from '@/types';

// 测试环境 jsdom 的 url 为 https://www.bilibili.com/，不能跨源 pushState。
// 通用适配器不关心具体域名，用同源路径即可。
const GENERIC_PATH = '/test-basic-web';

function resetPage(): void {
  document.body.innerHTML = '';
  history.pushState({}, '', GENERIC_PATH);
}

/** 模拟滚动到指定 Y 位置，触发 scroll 事件。 */
function scrollTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  window.dispatchEvent(new Event('scroll'));
}

describe('BasicWebAdapter — 适配器接口', () => {
  beforeEach(() => resetPage());

  it('id 为 basic-web', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    expect(adapter.id).toBe('basic-web');
  });

  it('findPrimaryVideo 始终返回 null', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    expect(adapter.findPrimaryVideo()).toBeNull();
  });

  it('getOverlayMode 返回 full-page', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    expect(adapter.getOverlayMode()).toBe('full-page');
  });

  it('isAdvertisement 始终 false', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    expect(adapter.isAdvertisement({} as HTMLVideoElement)).toBe(false);
  });

  it('isLivePage 始终 false', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    expect(adapter.isLivePage()).toBe(false);
  });
});

describe('BasicWebAdapter — 页面加载触发（AC3）', () => {
  beforeEach(() => resetPage());

  it('pageLoadTrigger=true：DOM 已就绪时同步发出事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: false });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events).toHaveLength(1);
    expect(events[0]!.video).toBeNull();
    expect(events[0]!.overlayMode).toBe('full-page');
    expect(events[0]!.identity).toContain('basic-web:load:');
  });

  it('pageLoadTrigger=false：不发出页面加载事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: false });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));
    expect(events).toHaveLength(0);
  });

  it('页面加载事件 video 为 null，overlayTarget 为 null', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: false });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events[0]!.video).toBeNull();
    expect(events[0]!.overlayTarget).toBeNull();
  });
});

describe('BasicWebAdapter — 滚动触发（AC3）', () => {
  beforeEach(() => {
    resetPage();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  it('scrollTrigger=true：累计滚动超过阈值后发出事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events).toHaveLength(0);

    // 滚动刚好达到阈值
    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(1);
    expect(events[0]!.video).toBeNull();
    expect(events[0]!.identity).toContain('basic-web:scroll:');
    expect(events[0]!.identity).toContain(':1');
  });

  it('滚动未达阈值不发出事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX - 100);
    expect(events).toHaveLength(0);
  });

  it('多次跨阈值可多次触发', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(1);

    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX * 2);
    expect(events).toHaveLength(2);

    expect(events[0]!.identity).not.toBe(events[1]!.identity);
  });

  it('scrollTrigger=false：不发出滚动事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: false });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX * 2);
    expect(events).toHaveLength(0);
  });

  it('反向滚动（向上）也累计绝对值', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    // 先向下滚 1000
    scrollTo(1000);
    // 再向上滚 1000（回到 0），累计 2000
    scrollTo(0);
    expect(events).toHaveLength(1);
  });
});

describe('BasicWebAdapter — 双触发独立开关（AC3）', () => {
  beforeEach(() => {
    resetPage();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  it('两个开关均开启：页面加载 + 滚动都能触发', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    // 页面加载事件
    expect(events).toHaveLength(1);
    expect(events[0]!.identity).toContain('basic-web:load:');

    // 滚动事件
    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(2);
    expect(events[1]!.identity).toContain('basic-web:scroll:');
  });

  it('仅页面加载：滚动不触发', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: false });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events).toHaveLength(1); // 页面加载
    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(1); // 滚动不触发
  });

  it('仅滚动：页面加载不触发', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    adapter.observePageChanges((event) => events.push(event));

    expect(events).toHaveLength(0); // 无页面加载
    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(1); // 滚动触发
  });
});

describe('BasicWebAdapter — cleanup', () => {
  beforeEach(() => {
    resetPage();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  it('cleanup 后滚动不再发出事件', () => {
    const adapter = new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true });
    const events: VideoChangeEvent[] = [];
    const stop = adapter.observePageChanges((event) => events.push(event));

    stop();
    scrollTo(SCROLL_TRIGGER_THRESHOLD_PX);
    expect(events).toHaveLength(0);
  });
});
