import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveCustomSiteAdapter } from '@/adapters/adaptive-custom-site';
import { BasicWebAdapter } from '@/adapters/basic-web';
import { GenericVideoAdapter } from '@/adapters/generic-video';
import type { VideoChangeEvent } from '@/types';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function reliableVideo(src = 'https://cdn.example.com/video.mp4'): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.getBoundingClientRect = () => ({
    left: 100,
    top: 100,
    right: 900,
    bottom: 550,
    width: 800,
    height: 450,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  return video;
}

describe('AdaptiveCustomSiteAdapter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('初始无视频时保留基础网页事件，异步视频出现后升级并发出视频事件', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    const adapter = new AdaptiveCustomSiteAdapter(
      new BasicWebAdapter({ pageLoadTrigger: true, scrollTrigger: false }),
      new GenericVideoAdapter(),
      onUpgrade,
    );
    const events: VideoChangeEvent[] = [];
    const stop = adapter.observePageChanges((event) => events.push(event));

    expect(events[0]?.video).toBeNull();
    expect(events[0]?.overlayMode).toBe('full-page');

    const video = reliableVideo();
    document.body.appendChild(video);
    await flush();

    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.video).toBe(video);
    expect(events.at(-1)?.overlayMode).toBe('full-page');
    stop();
  });

  it('升级后忽略后续基础网页滚动事件且不降级', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    const onUpgrade = vi.fn(async () => undefined);
    const adapter = new AdaptiveCustomSiteAdapter(
      new BasicWebAdapter({ pageLoadTrigger: false, scrollTrigger: true }),
      new GenericVideoAdapter(),
      onUpgrade,
    );
    const events: VideoChangeEvent[] = [];
    const stop = adapter.observePageChanges((event) => events.push(event));

    document.body.appendChild(reliableVideo());
    await flush();
    expect(events).toHaveLength(1);

    Object.defineProperty(window, 'scrollY', { value: 2500, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    await flush();

    expect(events).toHaveLength(1);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    stop();
  });
});
