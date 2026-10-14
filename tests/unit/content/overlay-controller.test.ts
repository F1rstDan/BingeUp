import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayController } from '@/content/overlay-controller';
import type { LearningItem } from '@/types';
// M4 PoC：vitest 默认不处理 CSS 导入（?raw 会变成空串），这里用构建产物形态的
// 夹具替代真实内联 CSS；真实的构建期内联组合由集成测试与 e2e 覆盖。
vi.mock('animal-island-ui/dist/index.css?raw', () => ({
  default:
    ':root{--animal-primary-color: #19c8b9;--animal-font-family: Nunito, "Noto Sans SC", sans-serif}' +
    '*,*:before,*:after{box-sizing:border-box}' +
    '[class^=animal-]{color:var(--animal-text-color)}' +
    '@font-face{font-family:Nunito;src:url(/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2) format("woff2")}',
}));

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
  document.getElementById('bingeup-island-preview-host')?.remove();
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

describe('OverlayController — M4 岛屿样式预览（PoC）', () => {
  const stubExtensionRuntime = (): void => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (assetPath: string) => 'chrome-extension://test-id/' + assetPath },
    });
  };

  const createTarget = (rect: { top: number; left: number; width: number; height: number }) => {
    const target = document.createElement('div');
    target.getBoundingClientRect = () => ({
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);
    return target;
  };

  it('在遮罩 ShadowRoot 内注入库样式（:host 令牌与 chrome-extension 字体）并渲染原版 Button/Card', async () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 40, left: 60, width: 800, height: 450 });
    const controller = new OverlayController();

    controller.openIslandPreview(target, 'video-region');

    const host = document.getElementById('bingeup-island-preview-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');
    expect(host?.style.boxSizing).toBe('border-box');
    expect(host?.style.width).toBe('800px');
    expect(host?.style.height).toBe('450px');
    expect(host?.style.left).toBe('60px');
    expect(host?.style.top).toBe('40px');

    const shadow = host?.shadowRoot ?? null;
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain(':host{--animal-primary-color');
    expect(styleText).toContain(
      'url("chrome-extension://test-id/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2")',
    );
    expect(styleText).not.toContain(':root{');

    await waitFor(() => {
      expect(shadow?.querySelector('button[class*="animal-btn"]')).not.toBeNull();
      expect(shadow?.querySelector('[class*="animal-card"]')).not.toBeNull();
    });

    controller.close();
  });

  it('库样式与节点不泄漏到宿主文档：无 document 级 style，无 body 新增节点', async () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 0, left: 0, width: 640, height: 360 });
    const bodyChildrenBefore = document.body.childElementCount;
    const headStylesBefore = document.head.querySelectorAll('style,link[rel="stylesheet"]').length;
    const controller = new OverlayController();

    controller.openIslandPreview(target, 'video-region');
    await waitFor(() => {
      expect(
        document.getElementById('bingeup-island-preview-host')?.shadowRoot?.querySelector('button'),
      ).not.toBeNull();
    });

    expect(document.head.querySelectorAll('style,link[rel="stylesheet"]').length).toBe(
      headStylesBefore,
    );
    expect(document.body.childElementCount).toBe(bodyChildrenBefore);
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelectorAll('[class^="animal-"]')).toHaveLength(0);

    controller.close();
  });

  it('重复打开不重复注入宿主，close 后宿主断开连接', () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 0, left: 0, width: 640, height: 360 });
    const rootChildrenBefore = document.documentElement.childElementCount;
    const controller = new OverlayController();

    controller.openIslandPreview(target, 'video-region');
    const firstHost = document.getElementById('bingeup-island-preview-host');
    expect(firstHost).not.toBeNull();

    controller.openIslandPreview(target, 'video-region');
    expect(document.querySelectorAll('#bingeup-island-preview-host')).toHaveLength(1);

    controller.close();
    expect(firstHost?.isConnected).toBe(false);
    expect(document.getElementById('bingeup-island-preview-host')).toBeNull();
    expect(document.documentElement.childElementCount).toBe(rootChildrenBefore);
  });

  it('滚动或布局变化后预览宿主随目标矩形刷新', () => {
    stubExtensionRuntime();
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
    const target = createTarget({ top, left, width: 800, height: 450 });
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
    const controller = new OverlayController();
    controller.openIslandPreview(target, 'video-region');

    top = 120;
    left = 140;
    window.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();

    const host = document.getElementById('bingeup-island-preview-host');
    expect(host?.style.top).toBe('120px');
    expect(host?.style.left).toBe('140px');
    controller.close();
  });
});
