import { describe, expect, it, vi } from 'vitest';
import {
  captureSnapshot,
  pauseForInteraction,
  restore,
  type VideoPlaybackPort,
} from '@/video/playback-controller';

/** 假视频：实现 VideoPlaybackPort，记录 pause/play 调用次数。 */
function makeFakeVideo(opts: { paused?: boolean; ended?: boolean; playFails?: boolean } = {}): VideoPlaybackPort & {
  pauseCalls: number;
  playCalls: number;
} {
  const fake = {
    paused: opts.paused ?? false,
    ended: opts.ended ?? false,
    currentTime: 12.5,
    playbackRate: 1.25,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      fake.pauseCalls += 1;
      fake.paused = true;
    },
    async play() {
      fake.playCalls += 1;
      if (opts.playFails) {
        throw new DOMException('play() rejected', 'AbortError');
      }
      fake.paused = false;
    },
  };
  return fake;
}

function counters(video: VideoPlaybackPort): { pauseCalls: number; playCalls: number } {
  const v = video as unknown as { pauseCalls: number; playCalls: number };
  return { pauseCalls: v.pauseCalls, playCalls: v.playCalls };
}

describe('playback controller', () => {
  describe('captureSnapshot', () => {
    it('正在播放的视频快照记 wasPlaying=true', () => {
      const video = makeFakeVideo({ paused: false });

      const snap = captureSnapshot(video);

      expect(snap.wasPlaying).toBe(true);
      expect(snap.currentTime).toBe(12.5);
      expect(snap.playbackRate).toBe(1.25);
    });

    it('已暂停的视频快照记 wasPlaying=false', () => {
      const video = makeFakeVideo({ paused: true });

      expect(captureSnapshot(video).wasPlaying).toBe(false);
    });

    it('已结束的视频快照记 wasPlaying=false', () => {
      const video = makeFakeVideo({ ended: true });

      expect(captureSnapshot(video).wasPlaying).toBe(false);
    });
  });

  describe('pauseForInteraction', () => {
    it('暂停视频并返回暂停前的快照', () => {
      const video = makeFakeVideo({ paused: false });

      const snap = pauseForInteraction(video);

      expect(snap.wasPlaying).toBe(true);
      expect(counters(video).pauseCalls).toBe(1);
    });

    it('对已经暂停的视频也会调用 pause（保证状态一致），但快照记 wasPlaying=false', () => {
      const video = makeFakeVideo({ paused: true });

      const snap = pauseForInteraction(video);

      expect(snap.wasPlaying).toBe(false);
      expect(counters(video).pauseCalls).toBe(1);
    });
  });

  describe('restore', () => {
    it('原本在播放的视频恢复时调用一次 play', async () => {
      const video = makeFakeVideo({ paused: false });
      const snap = pauseForInteraction(video);

      await restore(video, snap);

      expect(counters(video).playCalls).toBe(1);
    });

    it('原本暂停的视频恢复时不调用 play', async () => {
      const video = makeFakeVideo({ paused: true });
      const snap = pauseForInteraction(video);

      await restore(video, snap);

      expect(counters(video).playCalls).toBe(0);
    });

    it('play 失败时不抛出且不重试', async () => {
      const video = makeFakeVideo({ paused: false, playFails: true });
      const snap = pauseForInteraction(video);

      await expect(restore(video, snap)).resolves.toBeUndefined();
      expect(counters(video).playCalls).toBe(1);
    });
  });
});
