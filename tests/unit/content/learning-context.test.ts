import { describe, expect, it } from 'vitest';
import { normalizeLearningContext } from '@/content/learning-context';
import type { VideoChangeEvent } from '@/types';

function context(target: HTMLElement | DOMRect | null): VideoChangeEvent {
  return {
    identity: 'video-1',
    video: document.createElement('video'),
    overlayTarget: target,
    overlayMode: 'video-region',
  };
}

describe('normalizeLearningContext', () => {
  it('保留仍连接在页面中的稳定元素目标', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    expect(normalizeLearningContext(context(target))).toMatchObject({
      overlayTarget: target,
      overlayMode: 'video-region',
    });
  });

  it('一次性矩形目标降级为全网页遮罩', () => {
    const result = normalizeLearningContext(context(new DOMRect(10, 20, 800, 450)));

    expect(result.overlayTarget).toBe(document.documentElement);
    expect(result.overlayMode).toBe('full-page');
  });

  it('已断开页面的元素目标降级为全网页遮罩', () => {
    const result = normalizeLearningContext(context(document.createElement('div')));

    expect(result.overlayTarget).toBe(document.documentElement);
    expect(result.overlayMode).toBe('full-page');
  });
});
