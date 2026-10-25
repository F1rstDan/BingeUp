/** 设置与引导页使用的内置词库目录；单词和成员关系由正式内容包提供。 */
export interface BuiltInDeckMetadata {
  id: string;
  name: string;
  description?: string;
}

export const BUILT_IN_DECKS = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    description: '基于现代英语语料库词频排序的高频常用词汇',
  },
  {
    id: 'deck-cet4',
    name: '四级',
    description: '大学英语四级考试（CET-4）核心词汇',
  },
  {
    id: 'deck-cet6',
    name: '六级',
    description: '大学英语六级考试（CET-6）核心词汇',
  },
] as const satisfies readonly BuiltInDeckMetadata[];

/** 默认词库（首个内置词库）。 */
export function getDefaultDeck(): (typeof BUILT_IN_DECKS)[number] {
  return BUILT_IN_DECKS[0];
}
