import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireLockAt,
  incrementWordAttempts,
  parseBatchOutput,
  readJsonl,
  releaseLockAt,
  sampleIds,
  verifyBatchArtifacts,
  writeAtomic,
} from '../../../scripts/dictionary-rebuild/pipeline';

const INPUTS = [{ wordId: 'w-a' }, { wordId: 'w-b' }];

function entry(wordId: string) {
  return {
    wordId,
    word: wordId.replace('w-', ''),
    partOfSpeech: 'n.',
    coreMeaningZh: '测试',
    secondaryMeanings: [],
    exampleSentence: 'This is a test.',
    exampleTranslation: '这是一个测试。',
    surfaceFormInExample: 'test',
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('内容流水线 — 故障边界', () => {
  it('拒绝重复、未知和缺失目标 ID', () => {
    const { entries, failures } = parseBatchOutput(
      [entry('w-a'), entry('w-a'), entry('w-c')],
      INPUTS,
      1,
    );
    expect(entries.size).toBe(1);
    expect(failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining(['duplicate-id', 'unknown-id', 'missing-word']),
    );
  });

  it('拒绝缺字段或错误行', () => {
    const { failures } = parseBatchOutput(
      [{ wordId: 'w-a' }, { wordId: 'w-b', word: 'b' }],
      INPUTS,
      2,
    );
    expect(failures.every((failure) => failure.stage === 'structure')).toBe(true);
    expect(failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining(['invalid-entry']),
    );
  });

  it('半行 JSON 直接读取失败，不进入候选', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bingeup-pipeline-'));
    tempDirs.push(dir);
    const path = join(dir, 'partial.jsonl');
    writeFileSync(path, '{"wordId":"w-a"}\n{"wordId":', 'utf8');
    expect(() => readJsonl(path)).toThrow('不是合法 JSON');
  });

  it('尾批 1–3 词全部复核，普通批次至少 3 个样本', () => {
    expect(sampleIds('x', ['w-a'], 'seed')).toEqual(['w-a']);
    expect(sampleIds('x', ['w-a', 'w-b'], 'seed')).toHaveLength(2);
    expect(
      sampleIds(
        'x',
        Array.from({ length: 25 }, (_, index) => `w-${index}`),
        'seed',
      ),
    ).toHaveLength(3);
  });

  it('同一提示下累计次数，换提示重新计数', () => {
    const state = { wordAttempts: {} } as unknown as Parameters<typeof incrementWordAttempts>[0];
    incrementWordAttempts(state, ['w-a'], 'p1');
    incrementWordAttempts(state, ['w-a'], 'p1');
    incrementWordAttempts(state, ['w-a'], 'p2');
    expect(state.wordAttempts?.['w-a']).toEqual({ promptHash: 'p2', attempts: 1 });
  });

  it('同一状态文件不能同时被两个协调者持有', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bingeup-lock-'));
    tempDirs.push(dir);
    const path = join(dir, 'state.lock');
    acquireLockAt(path);
    expect(() => acquireLockAt(path)).toThrow('已被协调者持有');
    releaseLockAt(path);
    expect(() => acquireLockAt(path)).not.toThrow();
  });

  it('写入中断时保留原文件，完成后才原子替换', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bingeup-atomic-'));
    tempDirs.push(dir);
    const path = join(dir, 'state.json');
    writeFileSync(path, '{"version":1}', 'utf8');
    const temp = `${path}.${process.pid}.tmp`;
    mkdirSync(temp);
    expect(() => writeAtomic(path, '{"version":2}')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{"version":1}');
    rmSync(temp, { recursive: true });
    writeAtomic(path, '{"version":2}');
    expect(readFileSync(path, 'utf8')).toBe('{"version":2}');
    expect(existsSync(temp)).toBe(false);
  });

  it('批次文件丢失时返回返工原因，不重算哈希', () => {
    const errors = verifyBatchArtifacts(
      {
        id: '__missing-batch__',
        kind: 'main',
        wordIds: [],
        inputHash: 'input',
        outputHash: 'output',
        generationPromptHash: 'generate',
        sampleWordIds: [],
        review: null,
      } as never,
      { datasetId: 'test' } as never,
      { registryHash: 'registry' } as never,
      { generate: 'generate', review: 'review' },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('输入文件缺失或损坏');
  });
});
