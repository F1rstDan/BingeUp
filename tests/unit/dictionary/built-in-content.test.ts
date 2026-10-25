import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { buildPackageTexts, packageFetchMock } from '../../helpers/content-package';

describe('BuiltInWordBank — 当前内容包', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('校验 manifest 与文件哈希后加载词条和题组', async () => {
    const { texts } = await buildPackageTexts();
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();

    expect(await bank.listWords()).toHaveLength(4);
    expect((await bank.getWord('w-reservoir'))?.word).toBe('reservoir');
    expect((await bank.getQuestionPlan('w-reservoir'))?.wordId).toBe('w-reservoir');
    expect(await bank.getWord('w-reservior')).toBeNull();
    expect(await bank.getQuestionPlan('w-reservior')).toBeNull();
  });

  it('任何资源哈希不符时拒绝加载', async () => {
    const { texts } = await buildPackageTexts();
    texts['words.json'] = texts['words.json']!.replace('水库', '水池');
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('内容包校验失败');
  });

  it('缺少 manifest 时拒绝加载', async () => {
    const { texts } = await buildPackageTexts();
    delete texts['manifest.json'];
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('manifest 缺失');
  });

  it('manifest schemaVersion 非法时格式校验失败', async () => {
    const { texts, manifest } = await buildPackageTexts();
    texts['manifest.json'] = JSON.stringify({ ...manifest, schemaVersion: 99 });
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('schemaVersion 必须为 1');
  });
});
