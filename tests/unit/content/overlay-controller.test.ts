import { afterEach, describe, expect, it } from 'vitest';
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
});
