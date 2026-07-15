import type { VideoChangeEvent } from '@/types';

/** Raw rectangles cannot follow page layout, so video-region mode requires a live element. */
export function normalizeLearningContext(event: VideoChangeEvent): VideoChangeEvent {
  if (event.overlayMode !== 'video-region') return event;
  if (event.overlayTarget instanceof HTMLElement && event.overlayTarget.isConnected) return event;
  return {
    ...event,
    overlayTarget: document.documentElement,
    overlayMode: 'full-page',
  };
}
