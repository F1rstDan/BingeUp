import { STORES, type Migration } from '@/storage/database';
import type { CardRecord, ReviewLogRecord } from '@/types';

/** ADR-0003 直接切换后的数据空间；旧开发数据库不做运行时迁移。 */
export const DATABASE_NAME = 'bingeup-v1';

/**
 * 「刷刷升级」数据库迁移列表。
 *
 * 版本 1：创建 cards（带 wordId 索引）、reviewLogs（带 cardId 索引）、words、decks。
 * 版本 2：新增 sessionLogs 仓库（带 startedAt 索引），用于本地学习统计（Issue #12）。
 * 版本 3：新增权威状态仓库；开发期数据不迁移（ADR-0003）。
 * 版本 4：将 cards.byWordId 索引升级为唯一索引，持久化层强制一单词一卡（Issue #19 AC1）。
 *         按 wordId 合并：保留最早学习关系、最新进度，并将全部复习日志重绑到保留卡。
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
      // 最早创建的卡定义学习关系，最近更新的卡提供学习进度；日志随卡一起合并。
      // 迁移事务中无法 await，使用 openCursor + onsuccess 回调链在事务范围内同步推进。
      const keepByWordId = new Map<
        string,
        { first: CardRecord; latest: CardRecord; ids: string[] }
      >();
      const cursorRequest = cardsStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          const redirectedCardIds = new Map<string, string>();
          for (const { first, latest, ids } of keepByWordId.values()) {
            if (first !== latest) {
              cardsStore.put({
                ...latest,
                id: first.id,
                deckId: first.deckId,
                createdAt: first.createdAt,
                origin: first.origin,
              });
            }
            for (const id of ids) {
              if (id !== first.id) {
                cardsStore.delete(id);
                redirectedCardIds.set(id, first.id);
              }
            }
          }

          // 等卡片写入完成后再重建唯一索引，仍在同一升级事务内。
          cardsStore.count().onsuccess = () => {
            if (cardsStore.indexNames.contains('byWordId')) {
              cardsStore.deleteIndex('byWordId');
            }
            cardsStore.createIndex('byWordId', 'wordId', { unique: true });

            // 重绑日志，保留日志 id、来源、评分及调度快照。
            const logsRequest = transaction.objectStore(STORES.reviewLogs).openCursor();
            logsRequest.onsuccess = () => {
              const logCursor = logsRequest.result;
              if (logCursor === null) return;
              const log = logCursor.value as ReviewLogRecord;
              const cardId = redirectedCardIds.get(log.cardId);
              if (cardId !== undefined) logCursor.update({ ...log, cardId });
              logCursor.continue();
            };
          };
          return;
        }
        const card = cursor.value as CardRecord;
        const existing = keepByWordId.get(card.wordId);
        if (existing === undefined) {
          keepByWordId.set(card.wordId, { first: card, latest: card, ids: [card.id] });
        } else {
          existing.ids.push(card.id);
          if (card.createdAt < existing.first.createdAt) existing.first = card;
          if (card.updatedAt > existing.latest.updatedAt) existing.latest = card;
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
