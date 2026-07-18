import { useCallback, useEffect, useState } from 'react';
import type { CardRecord, SchedulerState } from '@/types';
import type { DevDataSnapshot } from '@/dev-tools/messages';
import { getDevDataSnapshot } from '@/dev-tools/message-client';

export function DevToolsApp(): JSX.Element {
  const [snapshot, setSnapshot] = useState<DevDataSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setRefreshedAt(null);
    try {
      setSnapshot(await getDevDataSnapshot());
      setRefreshedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="bingeup-dev-page">
      <header className="bingeup-dev-page-header">
        <div>
          <p className="bingeup-dev-eyebrow">BingeUp / development</p>
          <h1>开发数据</h1>
          <p>只读查看当前本地学习卡、复习日志、会话日志与 FSRS 状态。</p>
          {refreshedAt !== null && (
            <small className="bingeup-dev-refreshed-at">
              最近刷新：{new Date(refreshedAt).toLocaleString()}
            </small>
          )}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : error !== null ? '重试' : '刷新数据'}
        </button>
      </header>

      {error !== null && <p className="bingeup-dev-page-error">加载失败：{error}</p>}
      {loading && snapshot === null && <p className="bingeup-dev-page-muted">加载中…</p>}
      {snapshot !== null && (
        <>
          <section>
            <div className="bingeup-dev-page-section-head">
              <h2>FSRS 状态</h2>
              <span>
                {snapshot.cards.filter((card) => card.schedulerState !== undefined).length}{' '}
                条有状态记录
              </span>
            </div>
            <FsrsTable cards={snapshot.cards} />
          </section>

          <DataSection title="学习卡" data={snapshot.cards} />
          <DataSection title="复习日志" data={snapshot.reviewLogs} />
          <DataSection title="会话日志" data={snapshot.sessionLogs} />
        </>
      )}
    </main>
  );
}

function DataSection({ title, data }: { title: string; data: unknown }): JSX.Element {
  const isEmpty = Array.isArray(data) && data.length === 0;
  return (
    <details className="bingeup-dev-data-section" open>
      <summary>
        <strong>{title}</strong>
        <span>{Array.isArray(data) ? `${data.length} 条` : ''}</span>
      </summary>
      {isEmpty ? (
        <p className="bingeup-dev-empty">暂无记录。</p>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
    </details>
  );
}

function FsrsTable({ cards }: { cards: CardRecord[] }): JSX.Element {
  const cardsWithSchedulerState = cards.filter((card) => card.schedulerState !== undefined);
  if (cardsWithSchedulerState.length === 0) {
    return <p className="bingeup-dev-page-muted">暂无 FSRS 状态。</p>;
  }
  return (
    <div className="bingeup-dev-table-wrap">
      <table className="bingeup-dev-table">
        <thead>
          <tr>
            <th>学习卡 / 单词</th>
            <th>阶段</th>
            <th>稳定性</th>
            <th>难度</th>
            <th>复习次数</th>
            <th>遗忘次数</th>
            <th>状态</th>
            <th>间隔（天）</th>
            <th>学习步</th>
            <th>上次复习</th>
          </tr>
        </thead>
        <tbody>
          {cardsWithSchedulerState.map((card) => (
            <FsrsRow key={card.id} card={card} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FsrsRow({ card }: { card: CardRecord }): JSX.Element {
  const state = card.schedulerState;
  return (
    <tr>
      <td>
        <code>{card.id}</code>
        <small>{card.wordId}</small>
      </td>
      <td>{card.stage}</td>
      <td>{formatNumber(state?.stability)}</td>
      <td>{formatNumber(state?.difficulty)}</td>
      <td>{formatNumber(state?.reps)}</td>
      <td>{formatNumber(state?.lapses)}</td>
      <td>{formatNumber(state?.state)}</td>
      <td>{formatNumber(state?.scheduledDays)}</td>
      <td>{formatNumber(state?.learningSteps)}</td>
      <td>{formatDate(state?.lastReviewAt)}</td>
    </tr>
  );
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: SchedulerState['lastReviewAt']): string {
  return value === undefined ? '—' : new Date(value).toLocaleString();
}
