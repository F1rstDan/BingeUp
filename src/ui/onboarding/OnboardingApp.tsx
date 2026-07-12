import { useState } from 'react';
import mascotUrl from '@/assets/level-up-mascot.png';
import { messageClient } from '@/messaging/message-client';
import {
  siteKeysToEnable,
  type OnboardingSiteSelection,
} from '@/onboarding/onboarding-service';

/**
 * 安装引导（Issue #9 AC1）。
 *
 * AC1：受支持站点默认启用；用户可在引导中取消启用任一站点。
 *
 * 流程：
 * 1. 欢迎页 → 说明插件用途；
 * 2. 网站选择 → 哔哩哔哩 / YouTube 默认勾选，可取消；
 * 3. 完成引导 → 同步保留勾选的网站启用状态；
 * 4. 成功页 → 提示刷新或访问已启用网站。
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

type Phase = 'select' | 'done' | 'error';

function LevelUpMascot(): JSX.Element {
  return <img className="bingeup-onboarding-mascot" src={mascotUrl} alt="" />;
}

export function OnboardingApp(): JSX.Element {
  const [selected, setSelected] = useState<Set<OnboardingSiteSelection>>(
    () => new Set(SITE_OPTIONS.map(({ key }) => key)),
  );
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
      await messageClient.completeOnboarding(siteKeysToEnable(sites));
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
          <button
            className="bingeup-btn-secondary"
            onClick={() => window.close()}
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bingeup-onboarding">
      <LevelUpMascot />
      <h1>欢迎使用<span className="bingeup-onboarding-brand-name">刷刷升级</span></h1>
      <p>在视频间隙轻量学习英语单词。已为你启用受支持网站，可按需取消：</p>

      <div className="bingeup-site-options">
        {SITE_OPTIONS.map((opt) => {
          const checked = selected.has(opt.key);
          return (
            <label
              key={opt.key}
              className={'bingeup-site-option' + (checked ? ' checked' : '')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSite(opt.key)}
              />
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
