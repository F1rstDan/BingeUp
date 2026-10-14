import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card } from 'animal-island-ui';
import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';

/**
 * 跳过引导后的有限启用提示（Issue #9 AC2；M6a 工单 #45 迁移为原版视觉）。
 *
 * 在受支持但未启用的网站上注入一个轻量横幅，提供"启用"和"暂不"两个入口。
 * 启用后展示"请刷新页面"提示；暂不则触发拒绝回调。组件本身不访问消息或存储，
 * 只通过回调通知调用方，便于测试与解耦。
 *
 * 横幅渲染在独立 ShadowRoot 内，并复用 M4 阴影管线（工单 #43）：库样式令牌映射到
 * :host、字体以 FontFace 注册为 chrome-extension 绝对路径；可见控件使用库原版
 * Card/Button，不在宿主页注入全局样式。文案与交互语义与既有实现一致。
 */

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

/**
 * 局部样式（bingeup- 前缀，只作用于本 ShadowRoot）：
 * - :host 先重置宿主继承，再声明块级呈现；
 * - 其余为布局职责（横幅宽度、间距、右对齐动作区），颜色与控件外观全部来自
 *   库原版组件与 var(--animal-*) 令牌。
 */
const PROMPT_CSS = `
  :host { all: initial; }
  :host { display: block; }
  .bingeup-enable-prompt-card {
    box-sizing: border-box;
    width: 296px;
    max-width: calc(100vw - 32px);
    display: grid;
    gap: 12px;
  }
  .bingeup-enable-prompt-text {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.6;
  }
  .bingeup-enable-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
`;

type PromptPhase = 'ask' | 'busy' | 'enabled';

interface EnablePromptViewProps {
  hostname: string;
  callbacks: EnablePromptCallbacks;
  onClose: () => void;
}

// 本文件是内容脚本的命令式入口（导出 showEnablePrompt 而非 React 组件），
// fast refresh 不适用；内部视图组件只服务该入口，无需拆分文件。
// eslint-disable-next-line react-refresh/only-export-components
function EnablePromptView({ hostname, callbacks, onClose }: EnablePromptViewProps): ReactNode {
  const [phase, setPhase] = useState<PromptPhase>('ask');

  if (phase === 'enabled') {
    return (
      <Card className="bingeup-enable-prompt-card">
        <p className="bingeup-enable-prompt-text">
          <strong>已启用。</strong>请刷新页面或新开标签页后开始学习。
        </p>
        <div className="bingeup-enable-prompt-actions">
          <Button type="primary" onClick={onClose}>
            知道了
          </Button>
        </div>
      </Card>
    );
  }

  const busy = phase === 'busy';
  const handleDismiss = (): void => {
    // 与既有实现一致：无论回调成败都移除横幅；失败只用于诊断，不阻塞关闭。
    void callbacks
      .onDismiss()
      .catch((error: unknown) => {
        console.error('[BingeUp] 记录启用提示拒绝失败', error);
      })
      .finally(onClose);
  };
  const handleEnable = (): void => {
    setPhase('busy');
    callbacks.onEnable().then(
      () => setPhase('enabled'),
      // 启用失败：恢复按钮可点击，横幅保留。
      () => setPhase('ask'),
    );
  };

  return (
    <Card className="bingeup-enable-prompt-card">
      <p className="bingeup-enable-prompt-text">
        在 {hostname} 上启用「刷刷升级」？启用后将在视频间隙弹出轻量学习题。
      </p>
      <div className="bingeup-enable-prompt-actions">
        <Button disabled={busy} onClick={handleDismiss}>
          暂不
        </Button>
        <Button type="primary" disabled={busy} onClick={handleEnable}>
          启用
        </Button>
      </div>
    </Card>
  );
}

interface ActivePrompt {
  dispose(): void;
}

let activePrompt: ActivePrompt | null = null;

function disposeActivePrompt(): void {
  const active = activePrompt;
  activePrompt = null;
  active?.dispose();
}

/**
 * 显示有限启用提示横幅。返回 handle 用于手动移除。
 * 同一页面只允许存在一个提示横幅（重复调用先移除旧的）。
 */
export function showEnablePrompt(
  hostname: string,
  callbacks: EnablePromptCallbacks,
): EnablePromptHandle {
  // 移除可能残留的旧横幅。
  disposeActivePrompt();
  document.getElementById(PROMPT_HOST_ID)?.remove();

  const bundle = getIslandShadowStyleBundle();
  registerIslandFontFaces(bundle.fontFaces);

  const host = document.createElement('div');
  host.id = PROMPT_HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PROMPT_CSS + '\n' + bundle.css;
  shadow.appendChild(style);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (activePrompt?.dispose === dispose) activePrompt = null;
    root.unmount();
    host.remove();
  };

  activePrompt = { dispose };
  root.render(<EnablePromptView hostname={hostname} callbacks={callbacks} onClose={dispose} />);
  document.documentElement.appendChild(host);

  return {
    remove: dispose,
  };
}
