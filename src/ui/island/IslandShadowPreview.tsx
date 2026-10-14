import type { ReactNode } from 'react';
import { Button, Card } from 'animal-island-ui';

/**
 * M4 Shadow DOM PoC（工单 #43）：在遮罩 ShadowRoot 内渲染原版 Card/Button 样例，
 * 供真实浏览器验证计算样式与字体加载。只走实验路径，不承载业务动作，M5 后删除。
 */
export function IslandShadowPreview(): ReactNode {
  return (
    <div className="bingeup-island-preview">
      <Card className="bingeup-island-preview-card">
        <p className="bingeup-island-preview-title">Animal Island Shadow PoC</p>
        <div className="bingeup-island-preview-actions">
          <Button type="primary">原版主按钮</Button>
          <Button size="small">原版小按钮</Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * 预览专用局部样式（bingeup- 前缀，不入宿主页）：先重置宿主继承，再由装载模块
 * 追加库令牌与 reset。宿主的 fixed/display/矩形刷新仍由 OverlayController 负责。
 */
export const ISLAND_SHADOW_PREVIEW_CSS = `
  :host { all: initial; }
  .bingeup-island-preview {
    position: absolute; inset: 0; display: grid; width: 100%; height: 100%;
    place-items: center; overflow: visible; background: rgba(31, 41, 55, .32);
  }
  .bingeup-island-preview-card { display: grid; gap: 12px; justify-items: center; }
  .bingeup-island-preview-title { margin: 0; font-weight: 700; }
  .bingeup-island-preview-actions { display: flex; gap: 10px; }
`;