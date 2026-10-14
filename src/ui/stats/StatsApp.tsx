import { useEffect, useState } from 'react';
import { Card, Progress, Tabs, Tag, type TagColor } from 'animal-island-ui';
import type { LearningStats } from '@/types';
import { StatsService } from '@/stats/stats-service';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import { BehaviorEventRepository } from '@/storage/repositories/behavior-event-repository';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase } from '@/storage/database';
import { DATABASE_NAME, MIGRATIONS } from '@/storage/migrations';
import { IslandPage, IslandSection } from '@/ui/island';

/**
 * 学习统计页（Issue #12；工单 #42 M3c 原版视觉迁移）。
 *
 * 统计口径与数据来源不变：仍直接读取本地数据库，经 StatsService 派生全部指标。
 * 页面结构改用 animal-island-ui 原版组件（Card/Progress/Tag/Tabs）与 island
 * 共享基础模块重新排版；文案、数值与空/非空状态与迁移前一致，不引入打卡、
 * 游戏等级或虚构进度。
 */

/** 百分比格式化；null 表示没有可计算的样本。 */
function pct(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function performancePct(completed: number, accuracy: number): string {
  return completed === 0 ? '—' : pct(accuracy);
}

export function StatsApp(): JSX.Element {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDatabase(DATABASE_NAME, MIGRATIONS);
        const store = new LocalSettingsStore(db);
        const [cards, logs, sessions, events, sites] = await Promise.all([
          new CardRepository(db).getAll(),
          new ReviewLogRepository(db).getAll(),
          new SessionLogRepository(db).getAll(),
          new BehaviorEventRepository(db).getAll(),
          store.listSites(),
        ]);
        db.close();
        const service = new StatsService({ clock: { now: () => Date.now() } });
        const result = service.computeStats(
          cards,
          logs,
          sessions,
          events,
          Object.fromEntries(sites.map(({ hostname, settings }) => [hostname, settings.enabled])),
        );
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
      <IslandPage className="bingeup-stats" label="学习统计">
        <h1>学习统计</h1>
        <Card className="bingeup-stats-state-card">
          <p className="bingeup-stats-error">加载失败：{error}</p>
        </Card>
      </IslandPage>
    );
  }

  if (stats === null) {
    return (
      <IslandPage className="bingeup-stats" label="学习统计">
        <h1>学习统计</h1>
        <Card className="bingeup-stats-state-card">
          <p className="bingeup-stats-loading">加载中…</p>
        </Card>
      </IslandPage>
    );
  }

  const totalCards =
    stats.cardStatus.shortTerm + stats.cardStatus.longTerm + stats.cardStatus.selfReported;

  /** 概览指标（AC2）：口径与文案与迁移前一致。 */
  const overviewMetrics = [
    { key: 'natural', label: '今日自然完成题目', value: stats.today.naturalCompletedQuestions },
    { key: 'reviewed', label: '今日复习词数', value: stats.today.reviewedWords },
    { key: 'week-days', label: '本周学习天数', value: stats.weekLearningDays },
    { key: 'due', label: '当前待复习词数', value: stats.dueReviewCount },
  ];

  /** 今日学习明细（AC1）：行文案与顺序与迁移前一致。 */
  const todayRows = [
    { key: 'natural', label: '自然完成题目', value: `${stats.today.naturalCompletedQuestions}` },
    { key: 'correct', label: '正确题数', value: `${stats.today.correctAnswers}` },
    { key: 'skip-rate', label: '自然交互跳过率', value: pct(stats.today.naturalSkipRate) },
    { key: 'reviewed', label: '复习词数', value: `${stats.today.reviewedWords}` },
    { key: 'pauses', label: '主动暂停次数', value: `${stats.today.activePauseCount}` },
    {
      key: 'long-term-completed',
      label: '长期复习完成题目',
      value: `${stats.longTermReview.today.completed}`,
    },
    {
      key: 'long-term-accuracy',
      label: '长期复习正确率',
      value: performancePct(
        stats.longTermReview.today.completed,
        stats.longTermReview.today.accuracy,
      ),
    },
    { key: 'new-words', label: '新词数', value: `${stats.today.newWords}` },
    {
      key: 'continuous-sessions',
      label: '连续学习会话',
      value: `${stats.today.continuousSessions}`,
    },
    {
      key: 'continuous-questions',
      label: '连续学习题数',
      value: `${stats.today.continuousQuestions}`,
    },
  ];

  /** 学习卡阶段分布（AC2）：原版 Tag 区分阶段，Progress 呈现占全部学习卡的占比。 */
  const stageRows: { key: string; label: string; color: TagColor; count: number }[] = [
    { key: 'short-term', label: '短期学习', color: 'app-teal', count: stats.cardStatus.shortTerm },
    { key: 'long-term', label: '长期复习', color: 'app-green', count: stats.cardStatus.longTerm },
    {
      key: 'self-reported',
      label: '自报已知',
      color: 'app-yellow',
      count: stats.cardStatus.selfReported,
    },
  ];

  const tabsItems = [
    {
      key: 'today',
      label: '今日',
      children: (
        <div className="bingeup-stats-panel">
          {/* AC2：统计页显示今日完成题数、今日复习词数、本周学习天数、待复习词数 */}
          <IslandSection title="概览">
            <div className="bingeup-stats-grid">
              {overviewMetrics.map((metric) => (
                <Card className="bingeup-stat-card" key={metric.key}>
                  <span className="bingeup-stat-value">{metric.value}</span>
                  <span className="bingeup-stat-label">{metric.label}</span>
                </Card>
              ))}
            </div>
          </IslandSection>

          {/* AC1：今日统计明细 */}
          <IslandSection title="今日学习">
            <Card className="bingeup-stats-detail">
              {todayRows.map((row) => (
                <div className="bingeup-stats-row" key={row.key}>
                  <span className="bingeup-stats-row-label">{row.label}</span>
                  <span className="bingeup-stats-row-value">{row.value}</span>
                </div>
              ))}
            </Card>
          </IslandSection>

          {/* AC2：学习卡状态 */}
          <IslandSection title="当前学习卡状态">
            {totalCards === 0 ? (
              <Card type="dashed" className="bingeup-stats-empty">
                <p className="bingeup-stats-row-label">还没有学习卡</p>
              </Card>
            ) : (
              <Card className="bingeup-stats-detail">
                {stageRows.map((stage) => (
                  <div className="bingeup-stats-stage-row" key={stage.key}>
                    <Tag size="small" color={stage.color}>
                      {stage.label}
                    </Tag>
                    <span className="bingeup-stats-stage-count">{stage.count}</span>
                    <Progress
                      className="bingeup-stats-stage-bar"
                      size="small"
                      showInfo={false}
                      percent={(stage.count / totalCards) * 100}
                      aria-label={`${stage.label}占比`}
                    />
                  </div>
                ))}
              </Card>
            )}
          </IslandSection>
        </div>
      ),
    },
    {
      key: 'trend',
      label: '趋势',
      children: (
        <div className="bingeup-stats-panel">
          <IslandSection title="近 7 日趋势">
            <Card className="bingeup-stats-detail">
              {stats.last7Days.map((day) => (
                <div className="bingeup-stats-row" key={day.dayStart}>
                  <span className="bingeup-stats-row-label">
                    {new Date(day.dayStart).toLocaleDateString()}
                  </span>
                  <span className="bingeup-stats-row-value">
                    自然 {day.naturalCompletedQuestions} · 跳过 {pct(day.naturalSkipRate)} · 暂停{' '}
                    {day.activePauseCount} · 连续 {day.continuousSessions}/{day.continuousQuestions}{' '}
                    · 长期 {day.longTermReview.completed}/
                    {performancePct(day.longTermReview.completed, day.longTermReview.accuracy)}
                  </span>
                </div>
              ))}
            </Card>
          </IslandSection>

          {/* AC2：周对比 */}
          <IslandSection title="周对比">
            <div className="bingeup-stats-comparison">
              <Card className="bingeup-stats-comparison-col">
                <span className="bingeup-stats-comparison-label">本周</span>
                <span className="bingeup-stats-comparison-value">
                  {stats.weekComparison.thisWeekCompleted}
                </span>
                <span className="bingeup-stats-comparison-sub">
                  完成题数 · 正确率 {pct(stats.weekComparison.thisWeekAccuracy)}
                </span>
              </Card>
              <Card className="bingeup-stats-comparison-col">
                <span className="bingeup-stats-comparison-label">上周</span>
                <span className="bingeup-stats-comparison-value">
                  {stats.weekComparison.lastWeekCompleted}
                </span>
                <span className="bingeup-stats-comparison-sub">
                  完成题数 · 正确率 {pct(stats.weekComparison.lastWeekAccuracy)}
                </span>
              </Card>
            </div>
          </IslandSection>

          <IslandSection title="全期长期复习表现">
            <Card className="bingeup-stats-detail">
              <div className="bingeup-stats-row">
                <span className="bingeup-stats-row-label">完成题目</span>
                <span className="bingeup-stats-row-value">
                  {stats.longTermReview.allTime.completed}
                </span>
              </div>
              <div className="bingeup-stats-row">
                <span className="bingeup-stats-row-label">正确率</span>
                <Progress
                  className="bingeup-stats-progress"
                  size="small"
                  percent={stats.longTermReview.allTime.accuracy * 100}
                  infoFormat={() =>
                    performancePct(
                      stats.longTermReview.allTime.completed,
                      stats.longTermReview.allTime.accuracy,
                    )
                  }
                  aria-label="全期长期复习正确率"
                />
              </div>
            </Card>
          </IslandSection>
        </div>
      ),
    },
    {
      key: 'sites',
      label: '网站',
      children: (
        <div className="bingeup-stats-panel">
          <IslandSection title="默认支持网站">
            <Card className="bingeup-stats-detail">
              {stats.defaultSites.map((site) => (
                <div className="bingeup-stats-row" key={site.hostname}>
                  <span className="bingeup-stats-row-label">{site.hostname}</span>
                  <span className="bingeup-stats-row-value bingeup-stats-site-value">
                    <Tag size="small" color={site.currentEnabled ? 'app-teal' : 'default'}>
                      {site.currentEnabled ? '已启用' : '已关闭'}
                    </Tag>{' '}
                    <span>· 连续启用 {site.continuousEnabledDays} 天</span>
                  </span>
                </div>
              ))}
            </Card>
          </IslandSection>
        </div>
      ),
    },
  ];

  return (
    <IslandPage className="bingeup-stats" label="学习统计">
      <h1>学习统计</h1>
      <Tabs className="bingeup-stats-tabs" aria-label="统计分区" items={tabsItems} />
    </IslandPage>
  );
}
