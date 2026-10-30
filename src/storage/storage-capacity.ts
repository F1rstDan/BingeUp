import type { StorageCapacityDiagnostic } from '@/types';

/** 浏览器存储保护与空间估算；失败不阻断权威数据读写。 */

export async function readStorageCapacity(): Promise<StorageCapacityDiagnostic> {
  const result: StorageCapacityDiagnostic = {
    unlimitedStorage: null,
    persisted: null,
    errors: [],
  };
  const measure = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      result.errors.push(`${label}：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await Promise.all([
    measure('存储权限读取失败', async () => {
      if (chrome.permissions?.contains) {
        result.unlimitedStorage = await chrome.permissions.contains({
          permissions: ['unlimitedStorage'],
        });
      }
    }),
    measure('持久化状态读取失败', async () => {
      if (navigator.storage?.persisted) result.persisted = await navigator.storage.persisted();
    }),
    measure('空间估算失败', async () => {
      if (navigator.storage?.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        if (typeof usage === 'number' && Number.isFinite(usage)) result.usage = usage;
        if (typeof quota === 'number' && Number.isFinite(quota)) result.quota = quota;
      }
    }),
    measure('备份空间读取失败', async () => {
      if (chrome.storage.local.getBytesInUse) {
        result.localBytes = await chrome.storage.local.getBytesInUse(null);
      }
    }),
  ]);
  return result;
}
