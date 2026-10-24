import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { buildV2PackageTexts, packageFetchMock } from '../../helpers/content-v2-package';

describe('BuiltInWordBank — 内容包 v2', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('校验 manifest 哈希后加载词条、题组与身份别名', async () => {
    const { texts } = await buildV2PackageTexts();
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();

    expect(await bank.listWords()).toHaveLength(4);
    expect(bank.getContentVersion()).toBe('2026.10.1');
    expect(bank.getContentKind()).toBe('content-v2');
    expect((await bank.getWord('w-reservior'))?.word).toBe('reservoir');
    expect((await bank.getQuestionPlan('w-reservior'))?.wordId).toBe('w-reservoir');
    expect((await bank.getLegacyRegistry())?.entries).toHaveLength(5);
  });

  it('任何资源哈希不符时拒绝加载', async () => {
    const { texts } = await buildV2PackageTexts();
    texts['words.json'] = texts['words.json']!.replace('水库', '水池');
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('内容包校验失败');
  });

  it('新内容缺少 manifest 时拒绝降级为旧包', async () => {
    const { texts } = await buildV2PackageTexts();
    delete texts['manifest.json'];
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    const bank = new BuiltInWordBank();
    await expect(bank.listWords()).rejects.toThrow('缺少 manifest');
  });
});
