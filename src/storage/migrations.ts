import { STORES, type Migration } from '@/storage/database';

/** ADR-0003 直接切换后的数据空间；旧开发数据库不做运行时迁移。 */
export const DATABASE_NAME = 'bingeup-v1';

/**
 * 「刷刷升级」数据库迁移列表。
 *
 * 版本 1：创建 cards（带 wordId 索引）、reviewLogs（带 cardId 索引）、words、decks。
 * 版本 2：新增 sessionLogs 仓库（带 startedAt 索引），用于本地学习统计（Issue #12）。
 * 版本 3：新增权威状态仓库；开发期数据不迁移（ADR-0003）。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始结构：cards、reviewLogs、words、decks 及关键索引',
    run: (db) => {
      const cards = db.createObjectStore(STORES.cards, { keyPath: 'id' });
      cards.createIndex('byWordId', 'wordId', { unique: false });

      const logs = db.createObjectStore(STORES.reviewLogs, { keyPath: 'id' });
      logs.createIndex('byCardId', 'cardId', { unique: false });

      db.createObjectStore(STORES.words, { keyPath: 'id' });
      db.createObjectStore(STORES.decks, { keyPath: 'id' });
    },
  },
  {
    version: 2,
    description: '新增 sessionLogs 仓库及 startedAt 索引（Issue #12 本地学习统计）',
    run: (db) => {
      const sessions = db.createObjectStore(STORES.sessionLogs, { keyPath: 'id' });
      sessions.createIndex('byStartedAt', 'startedAt', { unique: false });
    },
  },
  {
    version: 3,
    description: '新增长期设置、网站设置与安装引导的权威状态仓库（Issue #18）',
    run: (db) => {
      db.createObjectStore(STORES.authoritativeState, { keyPath: 'id' });
    },
  },
];
