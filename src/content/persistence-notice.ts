import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';

const NOTICE_ID = 'bingeup-persistence-notice';

export interface PersistenceNoticeOptions {
  retry: () => Promise<void>;
  dismiss: () => void;
  detail?: string;
}

export interface PersistenceNoticePort {
  showSaveUnconfirmed(options: PersistenceNoticeOptions): void;
  showBackupWarning(options: PersistenceNoticeOptions): void;
  close(): void;
}

const NOTICE_CSS = `
  :host { all: initial; }
  .bingeup-persistence-notice {
    box-sizing: border-box; padding: var(--animal-spacing-md) var(--animal-spacing-lg);
    border: var(--animal-border-width) solid var(--animal-border-color);
    border-left: 4px solid var(--animal-warning-color); border-radius: var(--animal-border-radius-base);
    background: var(--animal-bg-color); box-shadow: var(--animal-shadow-base);
    color: var(--animal-text-color); font-family: var(--animal-font-family);
    font-size: var(--animal-font-size-base); line-height: var(--animal-line-height-base);
    pointer-events: auto;
  }
  .bingeup-persistence-notice[data-kind="save"] { border-left-color: var(--animal-error-color-active); }
  .bingeup-persistence-notice__title {
    margin: 0; font-size: var(--animal-font-size-base); font-weight: 800; line-height: 1.4;
  }
  .bingeup-persistence-notice__detail {
    margin: var(--animal-spacing-xs) 0 0; color: var(--animal-text-color-secondary);
  }
  .bingeup-persistence-notice__status {
    min-height: 1.5em; margin: var(--animal-spacing-xs) 0 0;
    color: var(--animal-error-color-active); font-size: var(--animal-font-size-sm);
  }
  .bingeup-persistence-notice__actions {
    display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--animal-spacing-sm);
    margin-top: var(--animal-spacing-md);
  }
  .bingeup-persistence-notice__action {
    min-height: 40px; padding: 0 var(--animal-spacing-md);
    border: var(--animal-border-width) solid var(--animal-border-color);
    border-radius: var(--animal-border-radius-base); background: var(--animal-bg-color);
    color: var(--animal-text-color); font: inherit; font-weight: 700; cursor: pointer;
  }
  .bingeup-persistence-notice__action[data-primary="true"] {
    border-color: var(--animal-primary-color); background: var(--animal-primary-color);
  }
  .bingeup-persistence-notice__action:focus-visible {
    outline: 2px solid var(--animal-primary-color); outline-offset: 2px;
  }
  .bingeup-persistence-notice__action:disabled { cursor: wait; opacity: 0.65; }
`;

export class PersistenceNotice implements PersistenceNoticePort {
  private dispose: (() => void) | null = null;

  showSaveUnconfirmed(options: PersistenceNoticeOptions): void {
    this.show('save', options);
  }

  showBackupWarning(options: PersistenceNoticeOptions): void {
    this.show('backup', options);
  }

  close(): void {
    this.dispose?.();
  }

  private show(kind: 'save' | 'backup', options: PersistenceNoticeOptions): void {
    this.close();
    document.getElementById(NOTICE_ID)?.remove();

    const bundle = getIslandShadowStyleBundle();
    registerIslandFontFaces(bundle.fontFaces);

    const host = document.createElement('div');
    host.id = NOTICE_ID;
    Object.assign(host.style, {
      position: 'fixed',
      right: '20px',
      top: '20px',
      width: 'min(420px, calc(100vw - 40px))',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = bundle.css + '\n' + NOTICE_CSS;

    const notice = document.createElement('section');
    notice.className = 'bingeup-persistence-notice';
    notice.dataset.kind = kind;
    notice.setAttribute('role', 'alert');
    notice.setAttribute('aria-live', 'assertive');
    notice.setAttribute('aria-atomic', 'true');

    const title = document.createElement('h2');
    title.className = 'bingeup-persistence-notice__title';
    title.textContent = kind === 'save' ? '保存未获确认' : '学习记录已保存，自动备份未完成';

    const detail = document.createElement('p');
    detail.className = 'bingeup-persistence-notice__detail';
    detail.textContent =
      options.detail ??
      (kind === 'save'
        ? '这次学习记录尚未收到保存确认。原操作已保留，可手动重试。'
        : '本次学习记录已保存，可只重试自动备份。');

    const status = document.createElement('p');
    status.className = 'bingeup-persistence-notice__status';
    status.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'bingeup-persistence-notice__actions';
    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'bingeup-persistence-notice__action';
    dismissButton.textContent = '关闭提示';
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'bingeup-persistence-notice__action';
    retryButton.dataset.primary = 'true';
    retryButton.textContent = kind === 'save' ? '重试保存' : '重试备份';
    actions.append(dismissButton, retryButton);
    notice.append(title, detail, status, actions);
    shadow.append(style, notice);

    let disposed = false;
    let retrying = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      if (this.dispose === dispose) this.dispose = null;
      host.remove();
    };
    this.dispose = dispose;

    dismissButton.addEventListener('click', () => {
      if (disposed || retrying) return;
      dispose();
      options.dismiss();
    });
    retryButton.addEventListener('click', () => {
      if (disposed || retrying) return;
      retrying = true;
      retryButton.disabled = true;
      dismissButton.disabled = true;
      notice.setAttribute('aria-busy', 'true');
      status.textContent = kind === 'save' ? '正在重试保存…' : '正在重试自动备份…';
      void options
        .retry()
        .catch(() => {
          if (disposed) return;
          status.textContent =
            kind === 'save'
              ? '保存仍未确认，请再次重试或关闭提示。'
              : '自动备份仍未完成，请稍后重试或关闭提示。';
        })
        .finally(() => {
          if (disposed) return;
          retrying = false;
          retryButton.disabled = false;
          dismissButton.disabled = false;
          notice.removeAttribute('aria-busy');
        });
    });

    document.documentElement.appendChild(host);
  }
}
