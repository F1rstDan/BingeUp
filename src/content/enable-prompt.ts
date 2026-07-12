/**
 * 跳过引导后的有限启用提示（Issue #9 AC2）。
 *
 * 在受支持但未启用的网站上注入一个轻量横幅，提供"启用"和"暂不"两个入口。
 * 启用后展示"请刷新页面"提示；暂不则触发拒绝回调。组件本身不访问消息或存储，
 * 只通过回调通知调用方，便于测试与解耦。
 *
 * 使用 Shadow DOM 隔离样式，避免与宿主页面 CSS 冲突。
 */
import { SHADOW_DESIGN_TOKENS } from '@/ui/styles/shadow-design';

export interface EnablePromptCallbacks {
  /** 用户点击"启用"。调用方应启用站点；成功后组件切换到"请刷新"状态。 */
  onEnable: () => Promise<void>;
  /** 用户点击"暂不"。调用方应记录拒绝计数。 */
  onDismiss: () => Promise<void>;
}

export interface EnablePromptHandle {
  /** 移除横幅。 */
  remove(): void;
}

const PROMPT_HOST_ID = 'bingeup-enable-prompt-host';

const PROMPT_CSS = `
  ${SHADOW_DESIGN_TOKENS}
  .bingeup-prompt-root {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    font-family: var(--bingeup-font);
    color: var(--bingeup-ink);
    pointer-events: auto;
  }
  .bingeup-prompt-card {
    width: 296px;
    padding: 16px;
    border: 1px solid var(--bingeup-line);
    border-radius: var(--bingeup-radius-md);
    background: var(--bingeup-white);
    box-shadow: var(--bingeup-shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bingeup-prompt-title {
    font-size: 14px;
    font-weight: 900;
    line-height: 1.5;
  }
  .bingeup-prompt-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .bingeup-btn {
    border: none;
    border-radius: 11px;
    padding: 7px 14px;
    font-size: 13px;
    font-family: var(--bingeup-font);
    font-weight: 900;
    cursor: pointer;
    transition: 140ms ease;
  }
  .bingeup-btn-primary {
    background: var(--bingeup-blue);
    box-shadow: 0 3px 0 var(--bingeup-blue-dark);
    color: #fff;
  }
  .bingeup-btn-primary:hover { background: #2198ee; transform: translateY(-2px); }
  .bingeup-btn-secondary {
    background: #eef2f5;
    color: #536476;
    box-shadow: 0 3px 0 #dbe2e8;
  }
  .bingeup-btn-secondary:hover { transform: translateY(-2px); }
  .bingeup-btn:active { transform: translateY(1px); }
  .bingeup-prompt-hint {
    font-size: 13px;
    line-height: 1.5;
    color: var(--bingeup-muted);
  }
  .bingeup-prompt-hint strong { color: var(--bingeup-green-dark); }
`;

/**
 * 显示有限启用提示横幅。返回 handle 用于手动移除。
 * 同一页面只允许存在一个提示横幅（重复调用先移除旧的）。
 */
export function showEnablePrompt(hostname: string, callbacks: EnablePromptCallbacks): EnablePromptHandle {
  // 移除可能残留的旧横幅。
  document.getElementById(PROMPT_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = PROMPT_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PROMPT_CSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'bingeup-prompt-root';
  shadow.appendChild(root);

  renderPromptState(root, hostname, callbacks);

  document.documentElement.appendChild(host);

  return {
    remove() {
      host.remove();
    },
  };
}

/** 渲染初始询问状态（启用 / 暂不）。 */
function renderPromptState(
  root: HTMLDivElement,
  hostname: string,
  callbacks: EnablePromptCallbacks,
): void {
  const card = document.createElement('div');
  card.className = 'bingeup-prompt-card';

  const title = document.createElement('div');
  title.className = 'bingeup-prompt-title';
  title.textContent = `在 ${hostname} 上启用「刷刷升级」？启用后将在视频间隙弹出轻量学习题。`;
  card.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'bingeup-prompt-actions';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'bingeup-btn bingeup-btn-secondary';
  dismissBtn.type = 'button';
  dismissBtn.textContent = '暂不';
  dismissBtn.addEventListener('click', () => {
    void callbacks.onDismiss().finally(() => {
      hostOf(root)?.remove();
    });
  });

  const enableBtn = document.createElement('button');
  enableBtn.className = 'bingeup-btn bingeup-btn-primary';
  enableBtn.type = 'button';
  enableBtn.textContent = '启用';
  enableBtn.addEventListener('click', () => {
    enableBtn.disabled = true;
    dismissBtn.disabled = true;
    void callbacks
      .onEnable()
      .then(() => {
        renderEnabledHint(root, hostname);
      })
      .catch(() => {
        // 启用失败：恢复按钮可点击。
        enableBtn.disabled = false;
        dismissBtn.disabled = false;
      });
  });

  actions.appendChild(dismissBtn);
  actions.appendChild(enableBtn);
  card.appendChild(actions);
  root.appendChild(card);
}

/** 启用成功后渲染"请刷新页面"提示。 */
function renderEnabledHint(root: HTMLDivElement, _hostname: string): void {
  root.replaceChildren();
  const card = document.createElement('div');
  card.className = 'bingeup-prompt-card';

  const hint = document.createElement('div');
  hint.className = 'bingeup-prompt-hint';
  hint.innerHTML = '<strong>已启用。</strong>请刷新页面或新开标签页后开始学习。';
  card.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'bingeup-prompt-actions';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'bingeup-btn bingeup-btn-primary';
  closeBtn.type = 'button';
  closeBtn.textContent = '知道了';
  closeBtn.addEventListener('click', () => {
    hostOf(root)?.remove();
  });
  actions.appendChild(closeBtn);
  card.appendChild(actions);
  root.appendChild(card);
}

/** 从 Shadow DOM 内的子元素回溯到宿主 div。 */
function hostOf(node: Node): HTMLElement | null {
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    return root.host as HTMLElement;
  }
  return null;
}
