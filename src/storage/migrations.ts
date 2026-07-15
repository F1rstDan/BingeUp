import { STORES, type Migration } from '@/storage/database';

/** ADR-0003 直接切换后的数据空间；旧开发数据库不做运行时迁移。 */
export const DATABASE_NAME = 'bingeup-v1';

/**
 * 「刷刷升级」数据库迁移列表。
 *
 * 版本 1：创建 cards（带 wordId 索引）、reviewLogs（带 cardId 索引）、words、decks。
 * 版本 2：新增 sessionLogs 仓库（带 startedAt 索引），用于本地学习统计（Issue #12）。
 * 版本 3：新增权威状态仓库；开发期数据不迁移（ADR-0003）。
 * 版本 4：将 cards.byWordId 索引升级为唯一索引，持久化层强制一单词一卡（Issue #19 AC1）。
 *         升级前先按 wordId 去重，保留 createdAt 最早的卡片，避免历史脏数据阻塞索引创建。
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
  {
    version: 4,
    description: 'cards.byWordId 升级为唯一索引，持久化层强制一单词一卡（Issue #19 AC1）',
    run: (db, transaction) => {
      const cardsStore = transaction.objectStore(STORES.cards);
      // 先按 wordId 去重：保留 createdAt 最早的卡片，清理历史脏数据，避免唯一索引创建失败。
      // 迁移事务中无法 await，使用 openCursor + onsuccess 回调链在事务范围内同步推进。
      const keepByWordId = new Map<
        string,
        { record: Record<string, unknown>; createdAt: number }
      >();
      const cursorRequest = cardsStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          // 游标遍历完成：清空仓库并写回去重后的记录。
          cardsStore.clear();
          for (const { record } of keepByWordId.values()) {
            cardsStore.put(record);
          }
          // 重建唯一索引。
          if (cardsStore.indexNames.contains('byWordId')) {
            cardsStore.deleteIndex('byWordId');
          }
          cardsStore.createIndex('byWordId', 'wordId', { unique: true });
          return;
        }
        const value = cursor.value as Record<string, unknown>;
        const wordId = String(value.wordId ?? '');
        const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;
        const existing = keepByWordId.get(wordId);
        if (existing === undefined) {
          keepByWordId.set(wordId, { record: value, createdAt });
        } else if (createdAt < existing.createdAt) {
          existing.record = value;
          existing.createdAt = createdAt;
        }
        cursor.continue();
      };
    },
  },
  {
    version: 5,
    description: '新增 behaviorEvents 仓库及 occurredAt 索引（Issue #26 本地指标源事件）',
    run: (db) => {
      const events = db.createObjectStore(STORES.behaviorEvents, { keyPath: 'id' });
      events.createIndex('byOccurredAt', 'occurredAt', { unique: false });
    },
  },
];
