import { afterEach, describe, expect, it, vi } from 'vitest';
import { showPlaybackRecoveryNotice } from '@/content/playback-recovery-notice';

// M6a：vitest 默认不处理 CSS 导入（?raw 会变成空串），这里用构建产物形态的夹具替代
// 真实内联 CSS；真实的构建期内联组合由集成测试与 e2e 覆盖。
vi.mock('animal-island-ui/dist/index.css?raw', () => ({
  default:
    ':root{--animal-primary-color: #19c8b9;--animal-font-family: Nunito, "Noto Sans SC", sans-serif}' +
    '*,*:before,*:after{box-sizing:border-box}' +
    '[class^=animal-]{color:var(--animal-text-color)}' +
    '@font-face{font-family:Nunito;src:url(/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2) format("woff2")}',
}));

const NOTICE_ID = 'bingeup-playback-recovery-notice';

function stubExtensionRuntime(): void {
  vi.stubGlobal('chrome', {
    runtime: { getURL: (assetPath: string) => 'chrome-extension://test-id/' + assetPath },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.getElementById(NOTICE_ID)?.remove();
});

describe('showPlaybackRecoveryNotice', () => {
  it('以独立 ShadowRoot 呈现原版样式的不阻塞提示，并在六秒后消失', () => {
    vi.useFakeTimers();
    stubExtensionRuntime();

    showPlaybackRecoveryNotice();

    const host = document.getElementById(NOTICE_ID);
    expect(host).not.toBeNull();
    // 宿主页副作用只允许自身作用域的宿主：指针穿透、固定在右下角，light DOM 无内容。
    expect(host?.style.pointerEvents).toBe('none');
    expect(host?.style.position).toBe('fixed');
    expect(host?.textContent).toBe('');

    const shadow = host?.shadowRoot ?? null;
    const status = shadow?.querySelector('[role="status"]');
    expect(status).toHaveTextContent('视频未能自动继续，请手动播放');

    // M4 阴影管线：库令牌映射到 :host、字体重写为 chrome-extension 绝对路径。
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain(':host{--animal-primary-color');
    expect(styleText).not.toContain(':root{');
    expect(styleText).toContain('chrome-extension://test-id/assets/');

    vi.advanceTimersByTime(6_000);
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('样式与节点不泄漏到宿主文档', () => {
    stubExtensionRuntime();
    const headStylesBefore = document.head.querySelectorAll('style,link[rel="stylesheet"]').length;
    const bodyChildrenBefore = document.body.childElementCount;

    showPlaybackRecoveryNotice();

    expect(document.head.querySelectorAll('style,link[rel="stylesheet"]').length).toBe(
      headStylesBefore,
    );
    expect(document.body.childElementCount).toBe(bodyChildrenBefore);
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelectorAll('[class^="animal-"]')).toHaveLength(0);
  });

  it('重复调用先移除旧提示，且旧提示的计时器不会移除新提示', () => {
    vi.useFakeTimers();
    stubExtensionRuntime();

    showPlaybackRecoveryNotice();
    vi.advanceTimersByTime(3_000);
    showPlaybackRecoveryNotice();

    expect(document.querySelectorAll('#' + NOTICE_ID)).toHaveLength(1);

    // 旧提示的 6 秒计时点：不得移除新提示。
    vi.advanceTimersByTime(3_000);
    expect(document.getElementById(NOTICE_ID)).not.toBeNull();

    // 新提示自身到点后正常消失。
    vi.advanceTimersByTime(3_000);
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });
});
