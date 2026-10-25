import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeckRecord } from '@/types';
import { BUILT_IN_DECKS, getDefaultDeck } from '@/dictionary/built-in/decks';

const DELIVERED_DECKS = JSON.parse(
  readFileSync('public/dictionaries/decks.json', 'utf8'),
) as DeckRecord[];

describe('内置词库目录元数据', () => {
  it('与正式内容包保持相同的词库 ID、名称和顺序', () => {
    expect(BUILT_IN_DECKS.map(({ id, name }) => ({ id, name }))).toEqual(
      DELIVERED_DECKS.map(({ id, name }) => ({ id, name })),
    );
    expect(BUILT_IN_DECKS).toHaveLength(3);
  });

  it('默认词库是目录中的首项', () => {
    expect(getDefaultDeck()).toBe(BUILT_IN_DECKS[0]);
  });
});
