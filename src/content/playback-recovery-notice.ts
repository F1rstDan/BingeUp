const NOTICE_ID = 'bingeup-playback-recovery-notice';
const NOTICE_DURATION_MS = 6_000;

/** Shows a non-modal hint without covering or intercepting the site's player controls. */
export function showPlaybackRecoveryNotice(): void {
  document.getElementById(NOTICE_ID)?.remove();
  const notice = document.createElement('div');
  notice.id = NOTICE_ID;
  notice.textContent = '视频未能自动继续，请手动播放';
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    maxWidth: 'min(360px, calc(100vw - 40px))',
    padding: '12px 16px',
    borderRadius: '10px',
    color: '#ffffff',
    background: 'rgba(31, 41, 55, 0.94)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '14px',
    lineHeight: '1.4',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(notice);
  window.setTimeout(() => notice.remove(), NOTICE_DURATION_MS);
}
