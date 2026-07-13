import { useState } from 'react';
import mascotUrl from '@/assets/level-up-mascot.png';
import { messageClient } from '@/messaging/message-client';
import { siteKeysToEnable, type OnboardingSiteSelection } from '@/onboarding/onboarding-service';
import { BUILT_IN_DECKS, getDefaultDeck } from '@/dictionary/built-in/decks';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { SelfRatedLevel } from '@/types';

/**
 * 安装引导（Issue #9 AC1 / Issue #21）。
 *
 * AC1：受支持站点默认启用；用户可在引导中取消启用任一站点。
 * Issue #21：引导同时让用户选择当前词库与自评水平，选择会覆盖默认应用设置。
 *
 * 流程：
 * 1. 欢迎页 → 说明插件用途；
 * 2. 学习设置 → 选择学习水平与词库（默认取自 DEFAULT_SETTINGS）；
 * 3. 网站选择 → 哔哩哔哩 / YouTube 默认勾选，可取消；
 * 4. 完成引导 → 同步保留勾选的网站启用状态，并持久化所选词库与水平；
 * 5. 成功页 → 提示刷新或访问已启用网站。
 */

interface SiteOption {
  key: OnboardingSiteSelection;
  name: string;
  desc: string;
}

const SITE_OPTIONS: SiteOption[] = [
  { key: 'bilibili', name: '哔哩哔哩', desc: 'bilibili.com — 普通视频与竖屏视频' },
  { key: 'youtube', name: 'YouTube', desc: 'youtube.com — 普通视频与 Shorts' },
];

interface LevelOption {
  value: SelfRatedLevel;
  name: string;
  desc: string;
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: 'beginner', name: '初学', desc: '词汇量较小，从基础高频词开始' },
  { value: 'intermediate', name: '一般', desc: '具备日常词汇基础，继续巩固扩展' },
  { value: 'advanced', name: '进阶', desc: '词汇量较大，挑战中高难度词汇' },
];

type Phase = 'select' | 'done' | 'error';

function LevelUpMascot(): JSX.Element {
  return <img className="bingeup-onboarding-mascot" src={mascotUrl} alt="" />;
}

export function OnboardingApp(): JSX.Element {
  const [selected, setSelected] = useState<Set<OnboardingSiteSelection>>(
    () => new Set(SITE_OPTIONS.map(({ key }) => key)),
  );
  const [deckId, setDeckId] = useState<string>(() => getDefaultDeck().id);
  const [level, setLevel] = useState<SelfRatedLevel>(() => DEFAULT_SETTINGS.selfRatedLevel);
  const [phase, setPhase] = useState<Phase>('select');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleSite = (key: OnboardingSiteSelection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const sites = Array.from(selected);
      // 主机权限在安装时已声明；引导只同步用户最终保留的启用选择。
      // Issue #21：同时持久化用户选择的词库与自评水平。
      await messageClient.completeOnboarding({
        hostnames: siteKeysToEnable(sites),
        deckId,
        selfRatedLevel: level,
      });
      setPhase('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'done') {
    return (
      <div className="bingeup-onboarding">
        <div className="bingeup-success">
          <LevelUpMascot />
          <h2>引导完成</h2>
          <p className="bingeup-onboarding-copy">
            {selected.size > 0
              ? '已启用所选网站。请访问对应视频页面，刷新后即可开始学习。'
              : '未选择任何网站。之后可在 Popup 面板中随时启用。'}
          </p>
          <button className="bingeup-btn-secondary" onClick={() => window.close()}>
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bingeup-onboarding">
      <LevelUpMascot />
      <h1>
        欢迎使用<span className="bingeup-onboarding-brand-name">刷刷升级</span>
      </h1>
      <p>在视频间隙轻量学习英语单词。先选择学习内容，再确认已为你启用的受支持网站。</p>

      <section
        className="bingeup-onboarding-section"
        aria-labelledby="bingeup-onboarding-learning-title"
      >
        <h2 id="bingeup-onboarding-learning-title">学习设置</h2>

        <div className="bingeup-onboarding-field">
          <span className="bingeup-onboarding-field-label">学习水平</span>
          <div
            className="bingeup-onboarding-options bingeup-onboarding-level-options"
            role="radiogroup"
            aria-label="学习水平"
          >
            {LEVEL_OPTIONS.map((opt) => {
              const checked = level === opt.value;
              return (
                <label
                  key={opt.value}
                  className={
                    'bingeup-onboarding-option bingeup-onboarding-option-sm' +
                    (checked ? ' checked' : '')
                  }
                >
                  <input
                    type="radio"
                    role="radio"
                    aria-checked={checked}
                    name="bingeup-onboarding-level"
                    value={opt.value}
                    checked={checked}
                    onChange={() => setLevel(opt.value)}
                  />
                  <div className="bingeup-site-info">
                    <span className="bingeup-site-name">{opt.name}</span>
                    <span className="bingeup-site-desc">{opt.desc}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="bingeup-onboarding-field">
          <span className="bingeup-onboarding-field-label">词库</span>
          <div className="bingeup-onboarding-options" role="radiogroup" aria-label="词库">
            {BUILT_IN_DECKS.map((deck) => {
              const checked = deckId === deck.id;
              return (
                <label
                  key={deck.id}
                  className={
                    'bingeup-onboarding-option bingeup-onboarding-option-sm' +
                    (checked ? ' checked' : '')
                  }
                >
                  <input
                    type="radio"
                    role="radio"
                    aria-checked={checked}
                    name="bingeup-onboarding-deck"
                    value={deck.id}
                    checked={checked}
                    onChange={() => setDeckId(deck.id)}
                  />
                  <div className="bingeup-site-info">
                    <span className="bingeup-site-name">{deck.name}</span>
                    {deck.description && (
                      <span className="bingeup-site-desc">{deck.description}</span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <p className="bingeup-onboarding-hint">之后可在设置页修改学习水平、词库与其他学习设置。</p>
      </section>

      <section
        className="bingeup-onboarding-section"
        aria-labelledby="bingeup-onboarding-sites-title"
      >
        <h2 id="bingeup-onboarding-sites-title">默认支持网站</h2>
        <div className="bingeup-site-options">
          {SITE_OPTIONS.map((opt) => {
            const checked = selected.has(opt.key);
            return (
              <label key={opt.key} className={'bingeup-site-option' + (checked ? ' checked' : '')}>
                <input type="checkbox" checked={checked} onChange={() => toggleSite(opt.key)} />
                <div className="bingeup-site-info">
                  <span className="bingeup-site-name">{opt.name}</span>
                  <span className="bingeup-site-desc">{opt.desc}</span>
                </div>
              </label>
            );
          })}
        </div>

        <p className="bingeup-onboarding-hint">
          取消所有网站也可以完成引导，之后可在 Popup 面板中随时重新启用。
        </p>
      </section>

      {errorMsg !== null && <p className="bingeup-error">出错了：{errorMsg}</p>}

      <button
        className="bingeup-btn-primary"
        disabled={submitting}
        onClick={() => void handleComplete()}
      >
        {submitting ? '处理中…' : '完成引导'}
      </button>
    </div>
  );
}
