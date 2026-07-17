import { buildFeedbackUrl } from '@/ui/feedback';

/**
 * Beta 反馈链接（Issue #27）。展示在 Popup 与设置页页脚。
 *
 * 点击后在新标签打开预填的 GitHub Issues 新建页面；不做任何埋点或数据上报。
 */
export function FeedbackLink(): JSX.Element {
  const version =
    typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return (
    <footer className="bingeup-feedback">
      <a
        className="bingeup-feedback-link"
        href={buildFeedbackUrl(version, userAgent)}
        target="_blank"
        rel="noreferrer noopener"
      >
        反馈问题或建议
      </a>
    </footer>
  );
}
