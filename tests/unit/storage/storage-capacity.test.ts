import { afterEach, expect, it, vi } from 'vitest';
import { readStorageCapacity } from '@/storage/storage-capacity';

afterEach(() => vi.unstubAllGlobals());

it('独立读取实际存储权限、持久化状态和两种空间用量', async () => {
  vi.stubGlobal('chrome', {
    permissions: { contains: vi.fn().mockResolvedValue(true) },
    storage: { local: { getBytesInUse: vi.fn().mockResolvedValue(123) } },
  });
  vi.stubGlobal('navigator', {
    storage: {
      persisted: vi.fn().mockResolvedValue(false),
      estimate: vi.fn().mockResolvedValue({ usage: 456, quota: 789 }),
    },
  });
  expect(await readStorageCapacity()).toEqual({
    unlimitedStorage: true,
    persisted: false,
    usage: 456,
    quota: 789,
    localBytes: 123,
    errors: [],
  });
});

it('空间读取失败时仍返回其他结果，不将未知权限报告为已授权', async () => {
  vi.stubGlobal('chrome', {
    permissions: { contains: vi.fn().mockRejectedValue(new Error('denied')) },
    storage: { local: { getBytesInUse: vi.fn().mockResolvedValue(123) } },
  });
  vi.stubGlobal('navigator', {
    storage: { estimate: vi.fn().mockRejectedValue(new Error('unavailable')) },
  });
  const result = await readStorageCapacity();
  expect(result).toMatchObject({ unlimitedStorage: null, persisted: null, localBytes: 123 });
  expect(result.usage).toBeUndefined();
  expect(result.errors).toHaveLength(2);
});
