import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistenceNotice } from '@/content/persistence-notice';

vi.mock('animal-island-ui/style?raw', () => ({
  default:
    ':root{--animal-primary-color:#19c8b9;--animal-font-family:Nunito,sans-serif}' +
    '@font-face{font-family:Nunito;src:url(/assets/nunito.woff2) format("woff2")}',
}));

const NOTICE_ID = 'bingeup-persistence-notice';

function shadow(): ShadowRoot {
  const root = document.getElementById(NOTICE_ID)?.shadowRoot;
  if (!root) throw new Error('Expected persistence notice');
  return root;
}

function button(label: string): HTMLButtonElement {
  const result = [...shadow().querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!result) throw new Error(`Expected button: ${label}`);
  return result;
}

let notice: PersistenceNotice;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => 'chrome-extension://test-id/' + path },
  });
  notice = new PersistenceNotice();
});

afterEach(() => {
  notice.close();
  document.getElementById(NOTICE_ID)?.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PersistenceNotice', () => {
  it('持久显示保存未确认，并可关闭或锁住重复重试', async () => {
    let resolveRetry!: () => void;
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const dismiss = vi.fn();
    notice.showSaveUnconfirmed({ retry, dismiss });

    const host = document.getElementById(NOTICE_ID);
    const alert = shadow().querySelector('[role="alert"]');
    expect(host).not.toBeNull();
    expect(host?.style.pointerEvents).toBe('none');
    expect(alert).toHaveTextContent('保存未获确认');
    expect(alert).toHaveTextContent('这次学习记录尚未收到保存确认');
    expect(alert).not.toHaveAttribute('aria-modal');

    vi.advanceTimersByTime(10 * 60_000);
    expect(document.getElementById(NOTICE_ID)).not.toBeNull();

    button('重试保存').click();
    button('重试保存').click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(button('重试保存')).toBeDisabled();
    expect(button('关闭提示')).toBeDisabled();

    resolveRetry();
    await Promise.resolve();
    await Promise.resolve();
    expect(button('重试保存')).not.toBeDisabled();

    button('关闭提示').click();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('备份告警明确记录已保存，只提供备份重试', async () => {
    const retry = vi.fn(async () => undefined);
    const dismiss = vi.fn();
    notice.showBackupWarning({ detail: '快照写入失败', retry, dismiss });

    const alert = shadow().querySelector('[role="alert"]');
    expect(alert).toHaveTextContent('学习记录已保存，自动备份未完成');
    expect(alert).toHaveTextContent('快照写入失败');
    expect(button('重试备份')).toBeInTheDocument();
    expect(shadow().querySelectorAll('button')).toHaveLength(2);

    button('重试备份').click();
    await Promise.resolve();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('备份提示默认文案使用可覆盖创建卡的学习记录表述', () => {
    notice.showBackupWarning({ retry: async () => undefined, dismiss: vi.fn() });
    expect(shadow().querySelector('[role="alert"]')).toHaveTextContent(
      '本次学习记录已保存，可只重试自动备份',
    );
  });

  it('重复显示替换旧提示，且旧按钮不会关闭新提示', () => {
    const firstDismiss = vi.fn();
    notice.showSaveUnconfirmed({ retry: async () => undefined, dismiss: firstDismiss });
    const oldClose = button('关闭提示');

    notice.showBackupWarning({ retry: async () => undefined, dismiss: vi.fn() });
    oldClose.click();

    expect(firstDismiss).not.toHaveBeenCalled();
    expect(document.getElementById(NOTICE_ID)).not.toBeNull();
    expect(shadow().querySelector('[role="alert"]')).toHaveTextContent(
      '学习记录已保存，自动备份未完成',
    );
  });
});
