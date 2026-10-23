import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';

/**
 * 播放恢复失败提示（M6a，工单 #45）。
 *
 * 视频未能自动继续时，在页面右下角显示一个不拦截指针的轻量提示，6 秒后自动消失。
 * 提示以独立 ShadowRoot 承载，并复用 M4 阴影管线（工单 #43）：库样式令牌映射到
 * :host、字体以 FontFace 注册为 chrome-extension 绝对路径。除自身作用域的宿主外，
 * 不向宿主页注入任何样式或节点；文案、role=status、6 秒消失与 pointer-events: none
 * 的既有语义不变。
 */

const NOTICE_ID = 'bingeup-playback-recovery-notice';
const CONTENT_ERROR_NOTICE_ID = 'bingeup-content-error-notice';
const NOTICE_DURATION_MS = 6_000;

/**
 * 局部样式（bingeup- 前缀，只作用于本 ShadowRoot）：
 * - :host 先重置宿主继承；
 * - 提示容器按原版通知规范以 var(--animal-*) 令牌上色（羊皮纸底、暖棕文字、
 *   2px 边框、18px 圆角、sm/base 级阴影），不硬编码颜色。
 */
const NOTICE_CSS = `
  :host { all: initial; }
  .bingeup-recovery-notice {
    box-sizing: border-box;
    max-width: min(384px, calc(100vw - 40px));
    padding: var(--animal-spacing-md) var(--animal-spacing-lg);
    border: var(--animal-border-width) solid var(--animal-border-color);
    border-radius: var(--animal-border-radius-base);
    background: var(--animal-bg-color);
    box-shadow: var(--animal-shadow-base);
    color: var(--animal-text-color);
    font-family: var(--animal-font-family);
    font-size: var(--animal-font-size-base);
    font-weight: 500;
    line-height: var(--animal-line-height-base);
  }
`;

let activeNoticeDispose: (() => void) | null = null;

function removeCurrentNotice(): void {
  const dispose = activeNoticeDispose;
  activeNoticeDispose = null;
  dispose?.();
}

/** Shows a non-modal hint without covering or intercepting the site's player controls. */
function showShadowNotice(hostId: string, text: string): void {
  removeCurrentNotice();
  // 兼容旧实现的单例约束：清理同 id 的残留宿主。
  document.getElementById(hostId)?.remove();

  const bundle = getIslandShadowStyleBundle();
  registerIslandFontFaces(bundle.fontFaces);

  const host = document.createElement('div');
  host.id = hostId;
  Object.assign(host.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    boxSizing: 'border-box',
    // 提示只读不交互：指针事件穿透，不遮挡播放器控件。
    pointerEvents: 'none',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = NOTICE_CSS + '\n' + bundle.css;
  shadow.appendChild(style);

  const notice = document.createElement('div');
  notice.className = 'bingeup-recovery-notice';
  notice.setAttribute('role', 'status');
  notice.textContent = text;
  shadow.appendChild(notice);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    if (activeNoticeDispose === dispose) activeNoticeDispose = null;
    host.remove();
  };
  const timer = window.setTimeout(dispose, NOTICE_DURATION_MS);
  activeNoticeDispose = dispose;

  document.documentElement.appendChild(host);
}

export function showPlaybackRecoveryNotice(): void {
  showShadowNotice(NOTICE_ID, '视频未能自动继续，请手动播放');
}

export function showContentUnavailableNotice(): void {
  showShadowNotice(CONTENT_ERROR_NOTICE_ID, '学习内容暂时不可用，视频已恢复播放');
}
