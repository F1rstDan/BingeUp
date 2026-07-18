import { useCallback, useEffect, useState } from 'react';
import type {
  DevCardType,
  DevDeckSummary,
  DevPingResponse,
  DevShowCardResult,
} from '@/dev-tools/messages';
import { getDevDeckSummary } from '@/dev-tools/message-client';
import { messageClient } from '@/messaging/message-client';
import './dev-tools.css';

interface ActiveTab {
  id: number;
  url: string;
}

type ContentAvailability = 'checking' | 'ready' | 'protected' | 'unavailable';

const CARD_ACTIONS: Array<{ type: DevCardType; label: string }> = [
  { type: 'new-word', label: '新词' },
  { type: 'en-to-zh', label: '英选中' },
  { type: 'zh-to-en', label: '中选英' },
  { type: 'context-choice', label: '语境' },
  { type: 'spelling', label: '拼写' },
];

const STAGE_LABELS: Array<{ key: keyof DevDeckSummary['stageCounts']; label: string }> = [
  { key: 'new', label: '新词' },
  { key: 'short-term', label: '短期学习词' },
  { key: 'long-term', label: '长期复习词' },
  { key: 'self-reported-known', label: '自报认识词' },
];

export function DevTools(): JSX.Element {
  const [summary, setSummary] = useState<DevDeckSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [availability, setAvailability] = useState<ContentAvailability>('checking');
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<DevCardType | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadSummary = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setSummary(null);
    setSummaryError(null);
    try {
      setSummary(await getDevDeckSummary());
      return true;
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await Promise.all([loadSummary(), checkActiveTab(setActiveTab, setAvailability)]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  const openCard = useCallback(
    async (cardType: DevCardType) => {
      if (activeTab === null || availability !== 'ready' || busyType !== null) return;
      setBusyType(cardType);
      setNotice(null);
      try {
        const response = (await chrome.tabs.sendMessage(activeTab.id, {
          type: 'DEV_SHOW_CARD',
          cardType,
        })) as DevShowCardResult | undefined;
        if (response?.ok) {
          window.close();
          return;
        }
        setNotice(devCardFailureMessage(response?.reason));
      } catch {
        setNotice('无法打开测试题卡，请重试');
      } finally {
        setBusyType(null);
      }
    },
    [activeTab, availability, busyType],
  );

  const clearProgress = useCallback(async () => {
    if (clearing) return;
    if (
      !window.confirm(
        '这是全局操作：将清除所有词库共享的学习卡、复习记录、学习会话和指标源事件，但保留单词、词库与网站设置。确定继续吗？',
      )
    ) {
      return;
    }
    setClearing(true);
    setNotice(null);
    try {
      await messageClient.clearLearningProgress();
      const summaryReloaded = await loadSummary();
      setNotice(
        summaryReloaded ? '学习进度已清除。' : '学习进度已清除，但摘要刷新失败，请点击“重试”。',
      );
    } catch (error) {
      setNotice(`清除失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setClearing(false);
    }
  }, [clearing, loadSummary]);

  return (
    <details className="bingeup-dev-tools" aria-labelledby="bingeup-dev-tools-title" open>
      <summary className="bingeup-dev-tools-heading">
        <span>
          <strong id="bingeup-dev-tools-title">开发工具</strong>
          <small>仅开发环境可见</small>
        </span>
      </summary>

      <div className="bingeup-dev-tools-body">
        <div className="bingeup-dev-group">
          <strong className="bingeup-dev-group-title">弹题卡</strong>
          <div className="bingeup-dev-card-grid">
            {CARD_ACTIONS.map(({ type, label }) => (
              <button
                key={type}
                className="bingeup-dev-card-button"
                type="button"
                disabled={availability !== 'ready' || busyType !== null}
                onClick={() => void openCard(type)}
              >
                {busyType === type ? '打开中…' : label}
              </button>
            ))}
          </div>
          <p className="bingeup-dev-status" role="status">
            {contentStatusMessage(availability)}
          </p>
        </div>

        <div className="bingeup-dev-group">
          <strong className="bingeup-dev-group-title">数据</strong>
          {loading && <p className="bingeup-dev-muted">加载中…</p>}
          {summaryError !== null && (
            <div className="bingeup-dev-summary-error">
              <p>开发数据加载失败：{summaryError}</p>
              <button type="button" onClick={() => void loadSummary()}>
                重试
              </button>
            </div>
          )}
          {summary !== null && (
            <div className="bingeup-dev-summary" aria-label="当前词库摘要">
              <div className="bingeup-dev-summary-title">
                <span>当前词库</span>
                <strong>{summary.deck.name}</strong>
              </div>
              <div className="bingeup-dev-summary-metrics">
                <span>
                  <strong>{summary.wordCount}</strong> 个单词
                </span>
                <span>
                  <strong>{summary.learningCardCount}</strong> 张学习卡
                </span>
              </div>
              <div className="bingeup-dev-stage-list">
                {STAGE_LABELS.map(({ key, label }) => (
                  <span key={key}>
                    {label} <strong>{summary.stageCounts[key]}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            className="bingeup-dev-link"
            type="button"
            onClick={() =>
              void chrome.tabs.create({ url: chrome.runtime.getURL('/dev-tools.html') })
            }
          >
            查看详细数据
          </button>

          {notice !== null && <p className="bingeup-dev-notice">{notice}</p>}

          <button
            className="bingeup-dev-clear"
            type="button"
            disabled={clearing}
            onClick={() => void clearProgress()}
          >
            {clearing ? '清除中…' : '清除全部学习进度'}
          </button>
        </div>
      </div>
    </details>
  );
}

async function checkActiveTab(
  onTab: (tab: ActiveTab | null) => void,
  onAvailability: (availability: ContentAvailability) => void,
): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) {
      onTab(null);
      onAvailability('unavailable');
      return;
    }
    const activeTab: ActiveTab = { id: tab.id, url: tab.url };
    onTab(activeTab);
    if (isProtectedUrl(tab.url)) {
      onAvailability('protected');
      return;
    }
    const response = (await sendDevPing(tab.id)) as DevPingResponse | undefined;
    onAvailability(response?.ok === true ? 'ready' : 'unavailable');
  } catch {
    onTab(null);
    onAvailability('unavailable');
  }
}

async function sendDevPing(tabId: number): Promise<unknown> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'DEV_PING' }),
      new Promise<undefined>((resolve) => {
        timer = window.setTimeout(() => resolve(undefined), 1000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function contentStatusMessage(availability: ContentAvailability): string {
  switch (availability) {
    case 'checking':
      return '正在检查当前页面…';
    case 'ready':
      return '当前页面已就绪，可打开测试题卡。';
    case 'protected':
      return '当前为浏览器受保护页面，无法打开测试题卡。';
    default:
      return '当前页面未连接内容脚本，请刷新页面后重试。';
  }
}

type DevCardFailure = Extract<DevShowCardResult, { ok: false }>['reason'];

function devCardFailureMessage(reason: DevCardFailure | undefined): string {
  switch (reason) {
    case 'interaction-active':
      return '当前已有学习界面';
    case 'no-unlearned-word':
      return '当前词库没有未学单词';
    case 'no-learning-content':
      return '当前词库没有可用单词';
    case 'no-context-example':
      return '当前词库没有可用例句';
    case 'insufficient-question-data':
      return '当前词库缺少生成该题型所需的数据';
    default:
      return '无法打开测试题卡，请重试';
  }
}

function isProtectedUrl(url: string): boolean {
  return /^(chrome|edge|about|view-source|chrome-extension|moz-extension):/i.test(url);
}
