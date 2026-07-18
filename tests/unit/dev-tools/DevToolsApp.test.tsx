import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DevToolsApp } from '@/ui/dev-tools/DevToolsApp';

const getSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/dev-tools/message-client', () => ({
  getDevDataSnapshot: getSnapshot,
}));

describe('开发数据页', () => {
  beforeEach(() => {
    getSnapshot.mockResolvedValue({
      cards: [
        {
          id: 'card-fsrs',
          wordId: 'word-one',
          deckId: 'deck-one',
          stage: 'long-term',
          createdAt: 1,
          updatedAt: 1,
          schedulerState: {
            stability: 4.2,
            difficulty: 5,
            reps: 2,
            lapses: 1,
            state: 2,
            scheduledDays: 3,
            learningSteps: 0,
            lastReviewAt: 1,
          },
        },
        {
          id: 'card-without-fsrs',
          wordId: 'word-two',
          deckId: 'deck-one',
          stage: 'short-term',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      reviewLogs: [],
      sessionLogs: [],
    });
  });

  afterEach(() => {
    getSnapshot.mockReset();
  });

  it('只显示拥有 schedulerState 的 FSRS 行，并对空记录显示明确状态', async () => {
    render(<DevToolsApp />);

    expect(await screen.findByText('card-fsrs')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryByText('card-without-fsrs'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('暂无记录。')).toHaveLength(2);
    expect(screen.getByText(/最近刷新：/)).toBeInTheDocument();
  });

  it('刷新失败时清掉旧快照并显示错误与重试入口', async () => {
    render(<DevToolsApp />);
    await screen.findByText('card-fsrs');
    getSnapshot.mockRejectedValueOnce(new Error('数据库读取失败'));

    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));

    await waitFor(() => expect(screen.getByText('加载失败：数据库读取失败')).toBeInTheDocument());
    expect(screen.queryByText('card-fsrs')).not.toBeInTheDocument();
  });
});
