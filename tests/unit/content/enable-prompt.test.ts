import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showEnablePrompt, type EnablePromptCallbacks } from '@/content/enable-prompt';

// M6a：vitest 默认不处理 CSS 导入（?raw 会变成空串），这里用构建产物形态的夹具替代
// 真实内联 CSS；真实的构建期内联组合由集成测试与 e2e 覆盖。
vi.mock('animal-island-ui/dist/index.css?raw', () => ({
  default:
    ':root{--animal-primary-color: #19c8b9;--animal-font-family: Nunito, "Noto Sans SC", sans-serif}' +
    '*,*:before,*:after{box-sizing:border-box}' +
    '[class^=animal-]{color:var(--animal-text-color)}' +
    '@font-face{font-family:Nunito;src:url(/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2) format("woff2")}',
}));

const PROMPT_HOST_ID = 'bingeup-enable-prompt-host';

function stubExtensionRuntime(): void {
  vi.stubGlobal('chrome', {
    runtime: { getURL: (assetPath: string) => 'chrome-extension://test-id/' + assetPath },
  });
}

function callbacks(overrides: Partial<EnablePromptCallbacks> = {}): EnablePromptCallbacks {
  return {
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function shadowOfPrompt(): ShadowRoot | null {
  return document.getElementById(PROMPT_HOST_ID)?.shadowRoot ?? null;
}

function findButton(shadow: ShadowRoot | null, label: string): HTMLButtonElement | undefined {
  return [...(shadow?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.includes(label),
  );
}

afterEach(() => {
  document.getElementById(PROMPT_HOST_ID)?.remove();
  vi.unstubAllGlobals();
});

describe('showEnablePrompt', () => {
  it('以 ShadowRoot 呈现原版卡片与按钮，样式不泄漏到宿主页', async () => {
    stubExtensionRuntime();
    showEnablePrompt('www.bilibili.com', callbacks());

    const host = document.getElementById(PROMPT_HOST_ID);
    expect(host).not.toBeNull();
    // 宿主只负责定位：light DOM 无内容，避免与宿主页样式/脚本互相影响。
    expect(host?.textContent).toBe('');
    expect(host?.style.position).toBe('fixed');
    expect(host?.style.right).toBe('16px');

    const shadow = shadowOfPrompt();
    await waitFor(() => {
      expect(findButton(shadow, '启用')).not.toBeUndefined();
      expect(findButton(shadow, '暂不')).not.toBeUndefined();
    });

    expect(shadow?.textContent).toContain(
      '在 www.bilibili.com 上启用「刷刷升级」？启用后将在视频间隙弹出轻量学习题。',
    );
    // 原版视觉来自库组件（Card/Button），而不是裸 HTML 自绘。
    expect(shadow?.querySelector('[class*="animal-card"]')).not.toBeNull();
    expect(findButton(shadow, '启用')?.className).toContain('animal-btn');

    // M4 阴影管线：库令牌映射到 :host、字体重写为 chrome-extension 绝对路径。
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain(':host{--animal-primary-color');
    expect(styleText).not.toContain(':root{');
    expect(styleText).toContain('chrome-extension://test-id/assets/');

    // 宿主页无新增样式与库节点。
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelectorAll('[class^="animal-"]')).toHaveLength(0);
  });

  it('点击启用后禁用按钮，成功后显示请刷新提示，知道了移除横幅', async () => {
    stubExtensionRuntime();
    let resolveEnable: (() => void) | undefined;
    const onEnable = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEnable = resolve;
        }),
    );
    showEnablePrompt('www.bilibili.com', callbacks({ onEnable }));

    const shadow = shadowOfPrompt();
    await waitFor(() => expect(findButton(shadow, '启用')).not.toBeUndefined());
    fireEvent.click(findButton(shadow, '启用')!);

    expect(onEnable).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(findButton(shadow, '启用')?.disabled).toBe(true);
      expect(findButton(shadow, '暂不')?.disabled).toBe(true);
    });

    resolveEnable!();
    await waitFor(() => expect(shadow?.textContent).toContain('已启用。'));
    expect(shadow?.textContent).toContain('请刷新页面或新开标签页后开始学习。');

    fireEvent.click(findButton(shadow, '知道了')!);
    expect(document.getElementById(PROMPT_HOST_ID)).toBeNull();
  });

  it('启用失败时恢复按钮可点击并保留横幅', async () => {
    stubExtensionRuntime();
    const onEnable = vi.fn().mockRejectedValue(new Error('enable failed'));
    showEnablePrompt('www.bilibili.com', callbacks({ onEnable }));

    const shadow = shadowOfPrompt();
    await waitFor(() => expect(findButton(shadow, '启用')).not.toBeUndefined());
    fireEvent.click(findButton(shadow, '启用')!);

    await waitFor(() => {
      expect(findButton(shadow, '启用')?.disabled).toBe(false);
      expect(findButton(shadow, '暂不')?.disabled).toBe(false);
    });
    expect(document.getElementById(PROMPT_HOST_ID)).not.toBeNull();
    expect(shadow?.textContent).toContain('在 www.bilibili.com 上启用');
  });

  it('点击暂不触发拒绝回调并移除横幅', async () => {
    stubExtensionRuntime();
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    showEnablePrompt('www.bilibili.com', callbacks({ onDismiss }));

    const shadow = shadowOfPrompt();
    await waitFor(() => expect(findButton(shadow, '暂不')).not.toBeUndefined());
    fireEvent.click(findButton(shadow, '暂不')!);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.getElementById(PROMPT_HOST_ID)).toBeNull());
  });

  it('拒绝回调失败时仍然移除横幅', async () => {
    stubExtensionRuntime();
    const onDismiss = vi.fn().mockRejectedValue(new Error('decline failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    showEnablePrompt('www.bilibili.com', callbacks({ onDismiss }));

    const shadow = shadowOfPrompt();
    await waitFor(() => expect(findButton(shadow, '暂不')).not.toBeUndefined());
    fireEvent.click(findButton(shadow, '暂不')!);

    await waitFor(() => expect(document.getElementById(PROMPT_HOST_ID)).toBeNull());
    consoleError.mockRestore();
  });

  it('同一页面只保留一个横幅，重复调用先移除旧的', async () => {
    stubExtensionRuntime();
    showEnablePrompt('first.example.com', callbacks());
    showEnablePrompt('second.example.com', callbacks());

    expect(document.querySelectorAll('#' + PROMPT_HOST_ID)).toHaveLength(1);
    await waitFor(() =>
      expect(document.getElementById(PROMPT_HOST_ID)?.shadowRoot?.textContent).toContain(
        'second.example.com',
      ),
    );
  });

  it('handle.remove 可移除横幅', async () => {
    stubExtensionRuntime();
    const handle = showEnablePrompt('www.bilibili.com', callbacks());
    await waitFor(() => expect(findButton(shadowOfPrompt(), '启用')).not.toBeUndefined());

    handle.remove();

    expect(document.getElementById(PROMPT_HOST_ID)).toBeNull();
  });
});
