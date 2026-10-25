import { describe, expect, it } from 'vitest';
import { readContentVersion } from '../../../scripts/dictionary/package';

describe('词库包脚本共用读取', () => {
  it('内容版本只从源元数据读取', () => {
    expect(readContentVersion('{"schemaVersion":1,"contentVersion":"1"}')).toBe('1');
  });

  it('拒绝缺失、空白或非法源元数据', () => {
    expect(() => readContentVersion('{"schemaVersion":1}')).toThrow('缺少 contentVersion');
    expect(() => readContentVersion('{"schemaVersion":1,"contentVersion":"  "}')).toThrow(
      '缺少 contentVersion',
    );
    expect(() => readContentVersion('{')).toThrow('不是合法 JSON');
  });

  it('schemaVersion 非法时格式校验失败', () => {
    expect(() => readContentVersion('{"schemaVersion":99,"contentVersion":"1"}')).toThrow(
      'schemaVersion 必须为 1',
    );
  });
});
