/**
 * 合并页面突变触发的检测，并在页面隐藏时停止非必要检测。
 *
 * MutationObserver 可能在一次 DOM 更新中连续回调；合并到同一微任务，既避免
 * 重复扫描，也在标签页重新可见时只补做一次最新状态检测。
 */
export function createPageObservationScheduler(detect: () => void): {
  schedule: () => void;
  dispose: () => void;
} {
  // 保存当前文档引用，避免测试环境销毁全局 document 后遗留微任务再次读取全局。
  const pageDocument = document;
  let queued = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || pageDocument.visibilityState === 'hidden' || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      // 测试/页面销毁后不再调用可能依赖全局 document 的检测逻辑。
      if (!disposed && typeof document !== 'undefined' && pageDocument.visibilityState !== 'hidden') {
        detect();
      }
    });
  };

  const onVisibilityChange = () => {
    if (pageDocument.visibilityState === 'visible') schedule();
  };
  pageDocument.addEventListener('visibilitychange', onVisibilityChange);

  return {
    schedule,
    dispose() {
      disposed = true;
      pageDocument.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
