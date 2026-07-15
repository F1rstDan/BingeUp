import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayController } from '@/content/overlay-controller';
import type { LearningItem } from '@/types';

const ITEM: LearningItem = {
  kind: 'question',
  question: {
    id: 'q-overlay',
    type: 'en-to-zh',
    cardId: 'card-overlay',
    wordId: 'word-overlay',
    prompt: 'influence',
    options: ['影响', '提高', '利益', '放弃'],
    correctIndex: 0,
    explanation: {
      word: 'influence',
      partOfSpeech: ['n.', 'v.'],
      meanings: ['影响'],
    },
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.getElementById('bingeup-overlay-host')?.remove();
});

describe('OverlayController — 视频区域布局', () => {
  it('host 保持块级定位并让遮罩根节点填满目标区域', () => {
    const target = document.createElement('div');
    target.getBoundingClientRect = () => ({
      width: 1200,
      height: 800,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);

    const controller = new OverlayController();
    controller.open(ITEM, target, 'video-region');

    const host = document.getElementById('bingeup-overlay-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');
    expect(host?.style.boxSizing).toBe('border-box');
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('position: absolute');

    controller.close();
  });

  it('滚动或布局变化后重新读取稳定元素的位置而不使用旧矩形', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    let top = 20;
    let left = 30;
    const target = document.createElement('div');
    target.getBoundingClientRect = () => ({
      width: 800,
      height: 450,
      top,
      left,
      right: left + 800,
      bottom: top + 450,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);
    const controller = new OverlayController();
    controller.open(ITEM, target, 'video-region');

    top = 120;
    left = 140;
    window.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();

    const host = document.getElementById('bingeup-overlay-host');
    expect(host?.style.top).toBe('120px');
    expect(host?.style.left).toBe('140px');
    expect(host?.style.width).toBe('800px');
    expect(host?.style.height).toBe('450px');
    controller.close();
  });
});
