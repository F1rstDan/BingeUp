import type { PlaybackSnapshot } from '@/types';

/**
 * 视频播放能力的最小端口。真实实现用 {@link adaptHtmlVideo} 适配 HTMLVideoElement；
 * 测试用 fake。遵循 SDK 风格接口，便于在系统边界处替换。
 */
export interface VideoPlaybackPort {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly currentTime: number;
  readonly playbackRate: number;
  pause(): void;
  play(): Promise<void>;
}

/**
 * 判断视频是否正在播放：未暂停且未结束。
 */
function isPlaying(video: VideoPlaybackPort): boolean {
  return !video.paused && !video.ended;
}

/**
 * 捕获当前播放快照。不修改视频状态。
 */
export function captureSnapshot(video: VideoPlaybackPort): PlaybackSnapshot {
  return {
    wasPlaying: isPlaying(video),
    currentTime: video.currentTime,
    playbackRate: video.playbackRate,
  };
}

/**
 * 交互前暂停视频：先记录快照（反映暂停前状态），再调用 pause。
 */
export function pauseForInteraction(video: VideoPlaybackPort): PlaybackSnapshot {
  const snapshot = captureSnapshot(video);
  video.pause();
  return snapshot;
}

/**
 * 交互后恢复视频：只有原本在播放的视频才会调用 play。
 * 失败时不抛出、不重试——避免无限重试导致页面卡死。
 */
export async function restore(video: VideoPlaybackPort, snapshot: PlaybackSnapshot): Promise<void> {
  if (!snapshot.wasPlaying) {
    return;
  }
  try {
    await video.play();
  } catch {
    // 浏览器可能拒绝自动播放；不重试，由上层决定是否提示用户。
  }
}

/**
 * 把真实 HTMLVideoElement 适配为 VideoPlaybackPort。
 */
export function adaptHtmlVideo(video: HTMLVideoElement): VideoPlaybackPort {
  return {
    get paused() {
      return video.paused;
    },
    get ended() {
      return video.ended;
    },
    get currentTime() {
      return video.currentTime;
    },
    get playbackRate() {
      return video.playbackRate;
    },
    pause: () => video.pause(),
    play: () => video.play(),
  };
}
