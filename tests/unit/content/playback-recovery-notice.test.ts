import { afterEach, describe, expect, it, vi } from 'vitest';
import { showPlaybackRecoveryNotice } from '@/content/playback-recovery-notice';

describe('showPlaybackRecoveryNotice', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('显示不阻塞播放器的右下角提示并在六秒后消失', () => {
    vi.useFakeTimers();

    showPlaybackRecoveryNotice();

    const notice = document.getElementById('bingeup-playback-recovery-notice');
    expect(notice).toHaveTextContent('视频未能自动继续，请手动播放');
    expect(notice?.style.pointerEvents).toBe('none');
    expect(notice?.style.position).toBe('fixed');

    vi.advanceTimersByTime(6_000);
    expect(document.getElementById('bingeup-playback-recovery-notice')).toBeNull();
  });
});
