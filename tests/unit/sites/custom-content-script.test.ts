import { describe, expect, it } from 'vitest';
import { customContentScriptId } from '@/sites/custom-content-script';

describe('自定义网站动态内容脚本', () => {
  it('不同精确 hostname 生成不同注册 ID', () => {
    expect(customContentScriptId('a-b.com')).not.toBe(customContentScriptId('a.b.com'));
  });
});
