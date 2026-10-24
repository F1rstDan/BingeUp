import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayController, OverlayErrorFallback } from '@/content/overlay-controller';
import type { LearningItem } from '@/types';
// M5 工单 #44：vitest 默认不处理 ?raw CSS 导入，这里用构建产物形态的夹具替代真实的
// 构建期内联 CSS（含 :root 令牌、reset 与 @font-face）；真实内联组合由构建产物校验
// 脚本与 e2e 覆盖。
vi.mock('animal-island-ui/style?raw', () => ({
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

/** 内容脚本的 chrome.runtime.getURL 在每个用例中提供扩展资源路径。 */
const stubExtensionRuntime = (): void => {
  vi.stubGlobal('chrome', {
    runtime: { getURL: (assetPath: string) => 'chrome-extension://test-id/' + assetPath },
  });
};

beforeEach(() => {
  stubExtensionRuntime();
});

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
      height: 600,
      top,
      left,
      right: left + 800,
      bottom: top + 600,
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
    expect(host?.style.height).toBe('600px');
    controller.close();
  });

  it('视频区域高度不足时让遮罩改用视口尺寸，避免裁切答题卡', () => {
    const target = document.createElement('div');
    target.getBoundingClientRect = () => ({
      width: 800,
      height: 300,
      top: 40,
      left: 60,
      right: 860,
      bottom: 340,
      x: 60,
      y: 40,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);

    const controller = new OverlayController();
    controller.open(ITEM, target, 'video-region');

    const host = document.getElementById('bingeup-overlay-host');
    expect(host?.style.left).toBe('0px');
    expect(host?.style.top).toBe('0px');
    expect(host?.style.width).toBe(`${document.documentElement.clientWidth}px`);
    expect(host?.style.height).toBe(`${document.documentElement.clientHeight}px`);

    controller.close();
  });
});

describe('OverlayErrorFallback — 错误边界回退界面（M5 工单 #44）', () => {
  it('使用原版 Card/Button 与图标呈现，并支持返回视频', () => {
    const onRecover = vi.fn();
    const { container } = render(createElement(OverlayErrorFallback, { onRecover }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('学习界面出现错误，视频仍可安全恢复。')).toBeInTheDocument();
    // 回退界面同样使用原版图标与按钮。
    expect(container.querySelector('svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回视频' }));
    expect(onRecover).toHaveBeenCalledTimes(1);
  });
});

describe('OverlayController — 岛屿样式与字体（M5 工单 #44）', () => {
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

  it('在真实遮罩 ShadowRoot 内注入库样式（:host 令牌与 chrome-extension 字体）并渲染原版 Card/按钮', async () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 40, left: 60, width: 800, height: 600 });
    const controller = new OverlayController();

    controller.open(ITEM, target, 'video-region');

    const host = document.getElementById('bingeup-overlay-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');
    expect(host?.style.boxSizing).toBe('border-box');
    expect(host?.style.width).toBe('800px');
    expect(host?.style.height).toBe('600px');
    expect(host?.style.left).toBe('60px');
    expect(host?.style.top).toBe('40px');

    const shadow = host?.shadowRoot ?? null;
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain(':host{--animal-primary-color');
    expect(styleText).toContain(
      'url("chrome-extension://test-id/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2")',
    );
    expect(styleText).not.toContain(':root{');
    // 遮罩底层使用原版 mask 令牌；不保留旧玻璃风格与旧蓝粉令牌。
    expect(styleText).toContain('var(--animal-mask-bg)');
    expect(styleText).not.toContain('backdrop-filter');
    expect(styleText).not.toContain('--bingeup-');
    expect(styleText).not.toContain('@container');
    expect(styleText).toContain('scrollbar-width: none');
    expect(styleText).not.toContain('overscroll-behavior: contain');

    await waitFor(() => {
      expect(shadow?.querySelector('.bingeup-overlay')).not.toBeNull();
      expect(shadow?.querySelector('[class*="animal-card"]')).not.toBeNull();
      expect(shadow?.querySelector('button[class*="animal-btn"]')).not.toBeNull();
      expect(shadow?.querySelectorAll('.bingeup-option')).toHaveLength(4);
    });

    controller.close();
  });

  it('打开遮罩时把库字体注册进 document.fonts，重复打开不重复注册', () => {
    stubExtensionRuntime();
    const added: unknown[] = [];
    class FakeFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors?: unknown,
      ) {}
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', {
      value: { add: (face: unknown) => added.push(face) },
      configurable: true,
    });
    const target = createTarget({ top: 0, left: 0, width: 640, height: 600 });
    const controller = new OverlayController();

    controller.open(ITEM, target, 'video-region');
    expect(added).toHaveLength(2);
    const face = (added as Array<{ family: string; source: string }>).find(
      (candidate) => candidate.family === 'Nunito',
    );
    expect(face?.source).toContain('chrome-extension://test-id/assets/');
    const chineseFace = (added as Array<{ family: string; source: string }>).find(
      (candidate) => candidate.family === 'ChillRoundM',
    );
    expect(chineseFace?.source).toContain('chrome-extension://test-id/fonts/ChillRoundM.otf');

    controller.close();
    controller.open(ITEM, target, 'video-region');
    expect(added).toHaveLength(2);
    controller.close();
  });

  it('库样式与节点不泄漏到宿主文档：无 document 级 style，无 body 新增节点', async () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 0, left: 0, width: 640, height: 600 });
    const bodyChildrenBefore = document.body.childElementCount;
    const headStylesBefore = document.head.querySelectorAll('style,link[rel="stylesheet"]').length;
    const controller = new OverlayController();

    controller.open(ITEM, target, 'video-region');
    await waitFor(() => {
      expect(hostCardQuery()).not.toBeNull();
    });

    expect(document.head.querySelectorAll('style,link[rel="stylesheet"]').length).toBe(
      headStylesBefore,
    );
    expect(document.body.childElementCount).toBe(bodyChildrenBefore);
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelectorAll('[class^="animal-"]')).toHaveLength(0);

    controller.close();
  });

  function hostCardQuery(): Element | null | undefined {
    return document
      .getElementById('bingeup-overlay-host')
      ?.shadowRoot?.querySelector('[class*="animal-card"]');
  }

  it('重复打开不重复注入宿主，close 后宿主断开连接', () => {
    stubExtensionRuntime();
    const target = createTarget({ top: 0, left: 0, width: 640, height: 600 });
    const rootChildrenBefore = document.documentElement.childElementCount;
    const controller = new OverlayController();

    controller.open(ITEM, target, 'video-region');
    const firstHost = document.getElementById('bingeup-overlay-host');
    expect(firstHost).not.toBeNull();

    controller.open(ITEM, target, 'video-region');
    expect(document.querySelectorAll('#bingeup-overlay-host')).toHaveLength(1);

    controller.close();
    expect(firstHost?.isConnected).toBe(false);
    expect(document.getElementById('bingeup-overlay-host')).toBeNull();
    expect(document.documentElement.childElementCount).toBe(rootChildrenBefore);
  });

  it('滚动或布局变化后遮罩宿主随目标矩形刷新', () => {
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
    const target = createTarget({ top, left, width: 800, height: 600 });
    target.getBoundingClientRect = () => ({
      width: 800,
      height: 600,
      top,
      left,
      right: left + 800,
      bottom: top + 600,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
    const controller = new OverlayController();
    controller.open(ITEM, target, 'video-region');

    top = 120;
    left = 140;
    window.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();

    const host = document.getElementById('bingeup-overlay-host');
    expect(host?.style.top).toBe('120px');
    expect(host?.style.left).toBe('140px');
    controller.close();
  });
});
