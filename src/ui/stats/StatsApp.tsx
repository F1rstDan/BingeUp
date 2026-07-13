import { useEffect, useState } from 'react';
import type { LearningStats } from '@/types';
import { StatsService } from '@/stats/stats-service';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import { openDatabase } from '@/storage/database';
import { DATABASE_NAME, MIGRATIONS } from '@/storage/migrations';

/** 百分比格式化：0 → "—"，0.5 → "50%"。 */
function pct(value: number): string {
  if (value === 0) return '—';
  return `${Math.round(value * 100)}%`;
}

export function StatsApp(): JSX.Element {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDatabase(DATABASE_NAME, MIGRATIONS);
        const [cards, logs, sessions] = await Promise.all([
          new CardRepository(db).getAll(),
          new ReviewLogRepository(db).getAll(),
          new SessionLogRepository(db).getAll(),
        ]);
        db.close();
        const service = new StatsService({ clock: { now: () => Date.now() } });
        const result = service.computeStats(cards, logs, sessions);
        if (!cancelled) setStats(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className="bingeup-stats">
        <h1>学习统计</h1>
        <p className="bingeup-stats-error">加载失败：{error}</p>
      </div>
    );
  }

  if (stats === null) {
    return (
      <div className="bingeup-stats">
        <h1>学习统计</h1>
        <p className="bingeup-stats-loading">加载中…</p>
      </div>
    );
  }

  const totalCards =
    stats.cardStatus.shortTerm + stats.cardStatus.longTerm + stats.cardStatus.selfReported;

  return (
    <div className="bingeup-stats">
      <h1>学习统计</h1>

      {/* AC2：统计页显示今日完成题数、今日复习词数、本周学习天数、待复习词数 */}
      <section>
        <h2>概览</h2>
        <div className="bingeup-stats-grid">
          <div className="bingeup-stat-card">
            <span className="bingeup-stat-value">{stats.today.completedQuestions}</span>
            <span className="bingeup-stat-label">今日完成题数</span>
          </div>
          <div className="bingeup-stat-card">
            <span className="bingeup-stat-value">{stats.today.reviewedWords}</span>
            <span className="bingeup-stat-label">今日复习词数</span>
          </div>
          <div className="bingeup-stat-card">
            <span className="bingeup-stat-value">{stats.weekLearningDays}</span>
            <span className="bingeup-stat-label">本周学习天数</span>
          </div>
          <div className="bingeup-stat-card">
            <span className="bingeup-stat-value">{stats.dueReviewCount}</span>
            <span className="bingeup-stat-label">待复习词数</span>
          </div>
        </div>
      </section>

      {/* AC1：今日统计明细 */}
      <section>
        <h2>今日学习</h2>
        <div className="bingeup-stats-detail">
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">完成题目</span>
            <span className="bingeup-stats-row-value">{stats.today.completedQuestions}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">正确题数</span>
            <span className="bingeup-stats-row-value">{stats.today.correctAnswers}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">跳过次数</span>
            <span className="bingeup-stats-row-value">{stats.today.skipped}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">复习词数</span>
            <span className="bingeup-stats-row-value">{stats.today.reviewedWords}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">新词数</span>
            <span className="bingeup-stats-row-value">{stats.today.newWords}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">连续学习会话</span>
            <span className="bingeup-stats-row-value">{stats.today.continuousSessions}</span>
          </div>
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">连续学习题数</span>
            <span className="bingeup-stats-row-value">{stats.today.continuousQuestions}</span>
          </div>
        </div>
      </section>

      {/* AC2：学习卡状态 */}
      <section>
        <h2>学习卡状态</h2>
        {totalCards === 0 ? (
          <p className="bingeup-stats-row-label">还没有学习卡</p>
        ) : (
          <>
            <div className="bingeup-stats-bar">
              {stats.cardStatus.shortTerm > 0 && (
                <div
                  className="bingeup-stats-bar-segment bingeup-stats-bar-short"
                  style={{ width: `${(stats.cardStatus.shortTerm / totalCards) * 100}%` }}
                />
              )}
              {stats.cardStatus.longTerm > 0 && (
                <div
                  className="bingeup-stats-bar-segment bingeup-stats-bar-long"
                  style={{ width: `${(stats.cardStatus.longTerm / totalCards) * 100}%` }}
                />
              )}
              {stats.cardStatus.selfReported > 0 && (
                <div
                  className="bingeup-stats-bar-segment bingeup-stats-bar-self"
                  style={{ width: `${(stats.cardStatus.selfReported / totalCards) * 100}%` }}
                />
              )}
            </div>
            <div className="bingeup-stats-bar-legend">
              <span className="bingeup-stats-legend-item">
                <span className="bingeup-stats-legend-dot bingeup-stats-bar-short" />
                短期学习 {stats.cardStatus.shortTerm}
              </span>
              <span className="bingeup-stats-legend-item">
                <span className="bingeup-stats-legend-dot bingeup-stats-bar-long" />
                长期复习 {stats.cardStatus.longTerm}
              </span>
              <span className="bingeup-stats-legend-item">
                <span className="bingeup-stats-legend-dot bingeup-stats-bar-self" />
                自报已知 {stats.cardStatus.selfReported}
              </span>
            </div>
          </>
        )}
      </section>

      {/* AC2：延迟复习正确率 */}
      <section>
        <h2>延迟复习正确率</h2>
        <div className="bingeup-stats-detail">
          <div className="bingeup-stats-row">
            <span className="bingeup-stats-row-label">长期复习词正确率</span>
            <span className="bingeup-stats-row-value">{pct(stats.delayedReviewAccuracy)}</span>
          </div>
        </div>
      </section>

      {/* AC2：周对比 */}
      <section>
        <h2>周对比</h2>
        <div className="bingeup-stats-comparison">
          <div className="bingeup-stats-comparison-col">
            <span className="bingeup-stats-comparison-label">本周</span>
            <span className="bingeup-stats-comparison-value">
              {stats.weekComparison.thisWeekCompleted}
            </span>
            <span className="bingeup-stats-comparison-sub">
              完成题数 · 正确率 {pct(stats.weekComparison.thisWeekAccuracy)}
            </span>
          </div>
          <div className="bingeup-stats-comparison-col">
            <span className="bingeup-stats-comparison-label">上周</span>
            <span className="bingeup-stats-comparison-value">
              {stats.weekComparison.lastWeekCompleted}
            </span>
            <span className="bingeup-stats-comparison-sub">
              完成题数 · 正确率 {pct(stats.weekComparison.lastWeekAccuracy)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
