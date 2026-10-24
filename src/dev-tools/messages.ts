import type {
  CardRecord,
  CardStage,
  LearningItem,
  ReviewLogRecord,
  SessionLogRecord,
} from '@/types';

/** 开发工具可请求的题卡类型。 */
export type DevCardType = 'new-word' | 'en-to-zh' | 'zh-to-en' | 'context-choice' | 'spelling';

const DEV_CARD_TYPES: readonly DevCardType[] = [
  'new-word',
  'en-to-zh',
  'zh-to-en',
  'context-choice',
  'spelling',
];

export function isDevCardType(value: unknown): value is DevCardType {
  return typeof value === 'string' && DEV_CARD_TYPES.includes(value as DevCardType);
}

export type DevCardFailureReason =
  'no-unlearned-word' | 'no-learning-content' | 'no-context-example' | 'insufficient-question-data';

export type PrepareDevCardResult =
  { ok: true; item: LearningItem } | { ok: false; reason: DevCardFailureReason };

export type DevContentMessage =
  { type: 'DEV_PING' } | { type: 'DEV_SHOW_CARD'; cardType: DevCardType };

export const DEV_SCENARIOS = [
  { id: 'week', label: '1 周' },
  { id: 'month', label: '1 个月' },
  { id: 'year', label: '1 年' },
  { id: 'complete', label: '全部学完' },
] as const;

export type DevScenario = (typeof DEV_SCENARIOS)[number]['id'];

export function isDevScenario(value: unknown): value is DevScenario {
  return DEV_SCENARIOS.some((scenario) => scenario.id === value);
}

export type DevPingResponse = { ok: true };

export type DevShowCardResult =
  | { ok: true }
  | {
      ok: false;
      reason: DevCardFailureReason | 'interaction-active' | 'failed';
    };

export type DevExtensionMessage =
  | { type: 'DEV_PREPARE_CARD'; cardType: DevCardType }
  | { type: 'DEV_GET_DECK_SUMMARY' }
  | { type: 'DEV_GET_DATA_SNAPSHOT' }
  | { type: 'DEV_SEED_SCENARIO'; scenario: DevScenario };

export interface DevDeckSummary {
  deck: { id: string; name: string };
  wordCount: number;
  learningCardCount: number;
  stageCounts: Record<CardStage, number>;
}

export interface DevDataSnapshot {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
}

export interface DevDataModule {
  getCurrentDeckSummary(): Promise<DevDeckSummary>;
  getSnapshot(): Promise<DevDataSnapshot>;
}
