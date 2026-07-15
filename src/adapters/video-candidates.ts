export const MIN_VIDEO_WIDTH = 200;
export const MIN_VIDEO_HEIGHT = 120;
const CLOSE_VISIBLE_AREA_RATIO = 0.1;

interface Candidate {
  video: HTMLVideoElement;
  visibleArea: number;
  totalArea: number;
  centerDistanceSquared: number;
  playing: boolean;
}

function candidateFor(video: HTMLVideoElement): Candidate | null {
  const rect = video.getBoundingClientRect();
  if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return null;
  const style = getComputedStyle(video);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    (style.opacity !== '' && Number(style.opacity) === 0)
  ) {
    return null;
  }
  if (video.muted && video.loop) return null;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const intersectionWidth = Math.max(
    0,
    Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
  );
  const visibleArea = intersectionWidth * intersectionHeight;
  if (visibleArea === 0) return null;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const deltaX = centerX - viewportWidth / 2;
  const deltaY = centerY - viewportHeight / 2;
  return {
    video,
    visibleArea,
    totalArea: rect.width * rect.height,
    centerDistanceSquared: deltaX * deltaX + deltaY * deltaY,
    playing: !video.paused && !video.ended,
  };
}

function isBetter(candidate: Candidate, current: Candidate): boolean {
  const largestVisibleArea = Math.max(candidate.visibleArea, current.visibleArea);
  const visibleAreasAreClose =
    Math.abs(candidate.visibleArea - current.visibleArea) <=
    largestVisibleArea * CLOSE_VISIBLE_AREA_RATIO;
  if (!visibleAreasAreClose) return candidate.visibleArea > current.visibleArea;
  if (candidate.playing !== current.playing) return candidate.playing;
  if (candidate.centerDistanceSquared !== current.centerDistanceSquared) {
    return candidate.centerDistanceSquared < current.centerDistanceSquared;
  }
  return candidate.totalArea > current.totalArea;
}

/** Select the video the user is actually watching from viewport-visible candidates. */
export function selectPrimaryVideo(
  videos: Iterable<HTMLVideoElement>,
  isExcluded: (video: HTMLVideoElement) => boolean = () => false,
): HTMLVideoElement | null {
  let best: Candidate | null = null;
  for (const video of videos) {
    if (isExcluded(video)) continue;
    const candidate = candidateFor(video);
    if (candidate !== null && (best === null || isBetter(candidate, best))) best = candidate;
  }
  return best?.video ?? null;
}
