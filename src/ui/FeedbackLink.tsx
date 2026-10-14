import { buildFeedbackUrl } from '@/ui/feedback';
import { IslandFooter } from '@/ui/island';

/**
 * Beta 反馈链接（Issue #27）。展示在 Popup 与设置页页脚。
 *
 * 点击后在新标签打开预填的 GitHub Issues 新建页面；不做任何埋点或数据上报。
 * 工单 #39 M2 起页脚使用 island 基础模块（原版分隔线 + 主题化链接），
 * 文案与链接语义保持不变。
 */
export function FeedbackLink(): JSX.Element {
  const version =
    typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return (
    <IslandFooter>
      <a
        className="island-link"
        href={buildFeedbackUrl(version, userAgent)}
        target="_blank"
        rel="noreferrer noopener"
      >
        反馈问题或建议
      </a>
    </IslandFooter>
  );
}
