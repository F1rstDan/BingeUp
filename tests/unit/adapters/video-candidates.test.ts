import { beforeEach, describe, expect, it } from 'vitest';
import { selectPrimaryVideo } from '@/adapters/video-candidates';

function videoAt(
  rect: { left: number; top: number; width: number; height: number },
  options: { playing?: boolean; muted?: boolean; loop?: boolean } = {},
): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = options.muted ?? false;
  video.loop = options.loop ?? false;
  Object.defineProperty(video, 'paused', {
    value: !(options.playing ?? false),
    configurable: true,
  });
  Object.defineProperty(video, 'ended', { value: false, configurable: true });
  video.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
  document.body.appendChild(video);
  return video;
}

describe('selectPrimaryVideo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('视口外的大视频不会胜过当前可见视频', () => {
    const offscreen = videoAt({ left: 0, top: 900, width: 1600, height: 900 });
    const visible = videoAt({ left: 200, top: 100, width: 800, height: 450 });

    expect(selectPrimaryVideo(document.querySelectorAll('video'))).toBe(visible);
    expect(selectPrimaryVideo([offscreen])).toBeNull();
  });

  it('相交面积接近时优先当前正在播放的视频', () => {
    videoAt({ left: 100, top: 100, width: 700, height: 400 });
    const playing = videoAt({ left: 120, top: 120, width: 680, height: 390 }, { playing: true });

    expect(selectPrimaryVideo(document.querySelectorAll('video'))).toBe(playing);
  });

  it('播放状态相同时优先距离视口中心更近的视频', () => {
    videoAt({ left: -100, top: 200, width: 400, height: 200 });
    const centered = videoAt({ left: 350, top: 200, width: 300, height: 200 });

    expect(selectPrimaryVideo(document.querySelectorAll('video'))).toBe(centered);
  });

  it('排除背景、小型、隐藏和站点声明排除的视频', () => {
    videoAt({ left: 0, top: 0, width: 900, height: 700 }, { muted: true, loop: true });
    videoAt({ left: 0, top: 0, width: 100, height: 80 });
    const excluded = videoAt({ left: 0, top: 0, width: 850, height: 650 });
    const valid = videoAt({ left: 100, top: 100, width: 700, height: 500 });

    expect(
      selectPrimaryVideo(document.querySelectorAll('video'), (video) => video === excluded),
    ).toBe(valid);
  });
});
