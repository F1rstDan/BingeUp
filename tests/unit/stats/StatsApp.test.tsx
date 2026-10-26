import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StatsApp } from '@/ui/stats/StatsApp';
import { idbReplaceAll, openDatabase, DATABASE_NAME } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import { startOfLocalDay } from '@/stats/stats-service';
import type { BehaviorEventRecord, CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';

/**
 * 统计页渲染（工单 #42，测试缝①：页面 App 渲染）。
 *
 * 断言用户可见的结构与文案：分区、Tab、指标值、空/非空状态与错误状态；
 * 统计口径由 stats-service.test.ts 覆盖，本文件只验证页面把同一口径的数据
 * 正确呈现，不冻结内部结构或类名。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 固定到周六，避免本地时区与周一/周末边界改变周对比和近 7 日窗口。
const NOW = new Date(2026, 6, 11, 10, 0, 0).getTime();
const TODAY_START = startOfLocalDay(NOW);

function makeCard(overrides: Partial<CardRecord> & { id: string; wordId: string }): CardRecord {
  return {
    deckId: 'deck-test',
    stage: 'short-term',
    origin: 'accepted-new',
    createdAt: TODAY_START - 5 * MS_PER_DAY,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeLog(
  overrides: Partial<ReviewLogRecord> & { id: string; wordId: string },
): ReviewLogRecord {
  return {
    cardId: `card-${overrides.wordId}`,
    questionType: 'en-to-zh',
    selectedAnswer: '答案',
    correctAnswer: '答案',
    isCorrect: true,
    responseTimeMs: 2000,
    reviewedAt: NOW,
    stageAtSubmission: 'short-term',
    source: 'natural',
    rating: 'good',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionLogRecord> & { id: string }): SessionLogRecord {
  return {
    startedAt: NOW,
    endedAt: NOW + 5000,
    mode: 'single',
    outcome: 'submitted',
    questionsAnswered: 1,
    source: 'natural',
    continuousQuestionsAnswered: 0,
    ...overrides,
  };
}

interface SeedOptions {
  cards?: CardRecord[];
  reviewLogs?: ReviewLogRecord[];
  sessionLogs?: SessionLogRecord[];
  behaviorEvents?: BehaviorEventRecord[];
  enableSites?: string[];
}

async function seedDatabase(options: SeedOptions): Promise<void> {
  const db = await openDatabase(DATABASE_NAME);
  await idbReplaceAll(db, {
    cards: options.cards ?? [],
    reviewLogs: options.reviewLogs ?? [],
    sessionLogs: options.sessionLogs ?? [],
    behaviorEvents: options.behaviorEvents ?? [],
  });
  const settings = new LocalSettingsStore(db);
  for (const hostname of options.enableSites ?? []) {
    await settings.enableSite(hostname);
  }
  db.close();
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('删除测试数据库失败'));
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await deleteDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StatsApp — 学习统计页（工单 #42）', () => {
  it('默认「今日」标签呈现概览、今日学习与当前学习卡状态', async () => {
    await seedDatabase({
      cards: [
        makeCard({ id: 'card-w1', wordId: 'w1', nextReviewAt: NOW - 1000 }),
        makeCard({
          id: 'card-w2',
          wordId: 'w2',
          stage: 'long-term',
          createdAt: TODAY_START - 10 * MS_PER_DAY,
          nextReviewAt: NOW - 2000,
        }),
        makeCard({
          id: 'card-w3',
          wordId: 'w3',
          stage: 'self-reported-known',
          createdAt: TODAY_START - 2 * MS_PER_DAY,
          nextReviewAt: NOW - 3000,
        }),
        makeCard({
          id: 'card-w4',
          wordId: 'w4',
          createdAt: TODAY_START + 1000,
          nextReviewAt: NOW - 4000,
        }),
      ],
      reviewLogs: [
        makeLog({ id: 'log-1', wordId: 'w1', source: 'natural', stageAtSubmission: 'short-term' }),
        makeLog({
          id: 'log-2',
          wordId: 'w2',
          source: 'natural',
          stageAtSubmission: 'long-term',
        }),
        makeLog({
          id: 'log-3',
          wordId: 'w3',
          isCorrect: false,
          source: 'manual',
          stageAtSubmission: 'self-reported-known',
        }),
      ],
      sessionLogs: [
        makeSession({ id: 's1', source: 'natural', initialOutcome: 'submitted' }),
        makeSession({
          id: 's2',
          mode: 'continuous',
          outcome: 'exit',
          questionsAnswered: 2,
          continuousQuestionsAnswered: 2,
        }),
      ],
    });

    render(<StatsApp />);

    const tablist = await screen.findByRole('tablist', { name: '统计分区' });
    expect(screen.getByRole('heading', { level: 1, name: '学习统计' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '今日' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: '趋势' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '网站' })).toBeInTheDocument();

    const overview = screen.getByRole('region', { name: '概览' });
    expect(within(overview).getByText('今日自然完成题目')).toBeInTheDocument();
    expect(within(overview).getByText('2')).toBeInTheDocument();
    expect(within(overview).getByText('今日复习词数')).toBeInTheDocument();
    expect(within(overview).getByText('3')).toBeInTheDocument();
    expect(within(overview).getByText('本周学习天数')).toBeInTheDocument();
    expect(within(overview).getByText('1')).toBeInTheDocument();
    expect(within(overview).getByText('当前待复习词数')).toBeInTheDocument();
    expect(within(overview).getByText('4')).toBeInTheDocument();

    const todayDetail = screen.getByRole('region', { name: '今日学习' });
    expect(within(todayDetail).getByText('自然完成题目')).toBeInTheDocument();
    expect(within(todayDetail).getByText('正确题数')).toBeInTheDocument();
    expect(within(todayDetail).getByText('自然交互跳过率')).toBeInTheDocument();
    expect(within(todayDetail).getByText('0%')).toBeInTheDocument();
    expect(within(todayDetail).getByText('长期复习完成题目')).toBeInTheDocument();
    expect(within(todayDetail).getByText('长期复习正确率')).toBeInTheDocument();
    expect(within(todayDetail).getByText('100%')).toBeInTheDocument();

    const cardStatus = screen.getByRole('region', { name: '当前学习卡状态' });
    expect(within(cardStatus).getByText('短期学习')).toBeInTheDocument();
    expect(within(cardStatus).getByText('长期复习')).toBeInTheDocument();
    expect(within(cardStatus).getByText('自报已知')).toBeInTheDocument();
  });

  it('没有学习卡时显示空状态，且概览为零值', async () => {
    await seedDatabase({});

    render(<StatsApp />);

    const cardStatus = await screen.findByRole('region', { name: '当前学习卡状态' });
    expect(within(cardStatus).getByText('还没有学习卡')).toBeInTheDocument();
    expect(within(cardStatus).queryAllByRole('progressbar')).toHaveLength(0);

    const overview = screen.getByRole('region', { name: '概览' });
    expect(within(overview).getAllByText('0')).toHaveLength(4);
  });

  it('非空状态按阶段显示数量与占比进度', async () => {
    await seedDatabase({
      cards: [
        makeCard({ id: 'card-a', wordId: 'a' }),
        makeCard({ id: 'card-b', wordId: 'b' }),
        makeCard({ id: 'card-c', wordId: 'c', stage: 'long-term' }),
        makeCard({ id: 'card-d', wordId: 'd', stage: 'self-reported-known' }),
      ],
    });

    render(<StatsApp />);

    const cardStatus = await screen.findByRole('region', { name: '当前学习卡状态' });
    expect(within(cardStatus).getByText('短期学习')).toBeInTheDocument();
    expect(within(cardStatus).getByText('2')).toBeInTheDocument();
    expect(within(cardStatus).getByText('长期复习')).toBeInTheDocument();
    expect(within(cardStatus).getByText('自报已知')).toBeInTheDocument();

    const bars = within(cardStatus).getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['50', '25', '25']);
  });

  it('「趋势」标签呈现近 7 日趋势、周对比与全期长期复习表现', async () => {
    const lastWeekLogAt = TODAY_START - 8 * MS_PER_DAY;
    await seedDatabase({
      cards: [makeCard({ id: 'card-w2', wordId: 'w2', stage: 'long-term' })],
      reviewLogs: [
        makeLog({
          id: 'log-today',
          wordId: 'w2',
          source: 'natural',
          stageAtSubmission: 'long-term',
        }),
        makeLog({
          id: 'log-last-1',
          wordId: 'w2',
          reviewedAt: lastWeekLogAt,
          stageAtSubmission: 'long-term',
        }),
        makeLog({
          id: 'log-last-2',
          wordId: 'w2',
          reviewedAt: lastWeekLogAt + 1000,
          isCorrect: false,
          stageAtSubmission: 'long-term',
        }),
      ],
    });

    render(<StatsApp />);

    fireEvent.click(await screen.findByRole('tab', { name: '趋势' }));

    const panel = screen.getByRole('tabpanel', { name: '趋势' });
    expect(within(panel).getByRole('region', { name: '近 7 日趋势' })).toBeInTheDocument();
    expect(
      within(panel).getByText(/自然 1 · 跳过 — · 暂停 0 · 连续 0\/0 · 长期 1\/100%/),
    ).toBeInTheDocument();

    const comparison = within(panel).getByRole('region', { name: '周对比' });
    expect(within(comparison).getByText('本周')).toBeInTheDocument();
    expect(within(comparison).getByText('完成题数 · 正确率 100%')).toBeInTheDocument();
    expect(within(comparison).getByText('上周')).toBeInTheDocument();
    expect(within(comparison).getByText('完成题数 · 正确率 50%')).toBeInTheDocument();

    const allTime = within(panel).getByRole('region', { name: '全期长期复习表现' });
    expect(within(allTime).getByText('完成题目')).toBeInTheDocument();
    expect(within(allTime).getByText('3')).toBeInTheDocument();
    expect(within(allTime).getByText('正确率')).toBeInTheDocument();
    expect(within(allTime).getByText('67%')).toBeInTheDocument();
    expect(within(allTime).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
  });

  it('「网站」标签呈现默认支持网站的启用状态与连续启用天数', async () => {
    await seedDatabase({
      enableSites: ['bilibili.com'],
      behaviorEvents: [
        {
          id: 'event-site-1',
          kind: 'site-enabled',
          occurredAt: NOW - 3 * MS_PER_DAY,
          hostname: 'bilibili.com',
          enabled: true,
        },
      ],
    });

    render(<StatsApp />);

    fireEvent.click(await screen.findByRole('tab', { name: '网站' }));

    const panel = screen.getByRole('tabpanel', { name: '网站' });
    const sites = within(panel).getByRole('region', { name: '默认支持网站' });
    expect(within(sites).getByText('bilibili.com')).toBeInTheDocument();
    expect(within(sites).getByText('已启用')).toBeInTheDocument();
    expect(within(sites).getByText(/连续启用 3 天/)).toBeInTheDocument();
    expect(within(sites).getByText('youtube.com')).toBeInTheDocument();
    expect(within(sites).getByText('已关闭')).toBeInTheDocument();
    expect(within(sites).getByText(/连续启用 0 天/)).toBeInTheDocument();
  });

  it('数据库不可用时显示加载失败', async () => {
    vi.stubGlobal('indexedDB', undefined);

    render(<StatsApp />);

    expect(await screen.findByText(/加载失败：/)).toBeInTheDocument();
  });
});
