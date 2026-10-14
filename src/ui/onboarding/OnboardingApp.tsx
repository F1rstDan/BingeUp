import { useState } from 'react';
import { Button, Card, Checkbox, Radio, Title } from 'animal-island-ui';
import type { CheckboxOption, RadioOption } from 'animal-island-ui';
import mascotUrl from '@/assets/level-up-mascot.png';
import { messageClient } from '@/messaging/message-client';
import { siteKeysToEnable, type OnboardingSiteSelection } from '@/onboarding/onboarding-service';
import { BUILT_IN_DECKS, getDefaultDeck } from '@/dictionary/built-in/decks';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { SelfRatedLevel } from '@/types';
import { IslandPage, IslandSection } from '@/ui/island';

/**
 * 安装引导（Issue #9 AC1 / Issue #21 / 工单 #40 原版视觉迁移）。
 *
 * AC1：受支持站点默认启用；用户可在引导中取消启用任一站点。
 * Issue #21：引导同时让用户选择当前词库与自评水平，选择会覆盖默认应用设置。
 * 工单 #40：全部步骤采用 animal-island-ui 原版组件（Card/Radio/Checkbox/Button/Title），
 * 页面外壳与区块复用 @/ui/island 基础模块；选择与提交语义保持不变，未新增引导步骤。
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

/** 选项两行文案（名称 + 说明）；原版 Radio / Checkbox 的 label 支持任意 ReactNode。 */
function optionLabel(name: string, desc: string | undefined): JSX.Element {
  return (
    <span className="bingeup-onboarding-option-text">
      <span className="bingeup-onboarding-option-name">{name}</span>
      {desc !== undefined && <span className="bingeup-onboarding-option-desc">{desc}</span>}
    </span>
  );
}

const LEVEL_RADIO_OPTIONS: RadioOption[] = LEVEL_OPTIONS.map((opt) => ({
  value: opt.value,
  label: optionLabel(opt.name, opt.desc),
}));

const DECK_RADIO_OPTIONS: RadioOption[] = BUILT_IN_DECKS.map((deck) => ({
  value: deck.id,
  label: optionLabel(deck.name, deck.description),
}));

const SITE_CHECKBOX_OPTIONS: CheckboxOption[] = SITE_OPTIONS.map((opt) => ({
  value: opt.key,
  label: optionLabel(opt.name, opt.desc),
}));

export function OnboardingApp(): JSX.Element {
  const [selected, setSelected] = useState<Set<OnboardingSiteSelection>>(
    () => new Set(SITE_OPTIONS.map(({ key }) => key)),
  );
  const [deckId, setDeckId] = useState<string>(() => getDefaultDeck().id);
  const [level, setLevel] = useState<SelfRatedLevel>(() => DEFAULT_SETTINGS.selfRatedLevel);
  const [phase, setPhase] = useState<Phase>('select');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      <IslandPage className="bingeup-onboarding">
        <Card className="bingeup-onboarding-done">
          <LevelUpMascot />
          <h2 className="bingeup-onboarding-done-title">
            <Title size="large">引导完成</Title>
          </h2>
          <p className="bingeup-onboarding-copy">
            {selected.size > 0
              ? '已启用所选网站。请访问对应视频页面，刷新后即可开始学习。'
              : '未选择任何网站。之后可在 Popup 面板中随时启用。'}
          </p>
          <Button size="large" onClick={() => window.close()}>
            关闭
          </Button>
        </Card>
      </IslandPage>
    );
  }

  return (
    <IslandPage className="bingeup-onboarding">
      <div className="bingeup-onboarding-hero">
        <LevelUpMascot />
        <h1 className="bingeup-onboarding-title">
          <Title size="large">欢迎使用刷刷升级</Title>
        </h1>
        <p>在视频间隙轻量学习英语单词。先选择学习内容，再确认已为你启用的受支持网站。</p>
      </div>

      <IslandSection title="学习设置">
        <Card className="bingeup-onboarding-card">
          <fieldset className="bingeup-onboarding-field">
            <legend className="bingeup-onboarding-field-label">学习水平</legend>
            <Radio
              options={LEVEL_RADIO_OPTIONS}
              value={level}
              onChange={(value) => setLevel(value as SelfRatedLevel)}
            />
          </fieldset>

          <fieldset className="bingeup-onboarding-field">
            <legend className="bingeup-onboarding-field-label">词库</legend>
            <Radio
              direction="vertical"
              options={DECK_RADIO_OPTIONS}
              value={deckId}
              onChange={(value) => setDeckId(String(value))}
            />
          </fieldset>

          <p className="bingeup-onboarding-hint">
            之后可在设置页修改学习水平、词库与其他学习设置。
          </p>
        </Card>
      </IslandSection>

      <IslandSection title="默认支持网站">
        <Card className="bingeup-onboarding-card">
          <Checkbox
            direction="vertical"
            options={SITE_CHECKBOX_OPTIONS}
            value={[...selected]}
            onChange={(values) => setSelected(new Set(values as OnboardingSiteSelection[]))}
          />
          <p className="bingeup-onboarding-hint">
            取消所有网站也可以完成引导，之后可在 Popup 面板中随时重新启用。
          </p>
        </Card>
      </IslandSection>

      {errorMsg !== null && (
        <Card className="bingeup-onboarding-error">
          <p className="bingeup-onboarding-error-text">出错了：{errorMsg}</p>
        </Card>
      )}

      <Button
        type="primary"
        size="large"
        block
        disabled={submitting}
        onClick={() => void handleComplete()}
      >
        {submitting ? '处理中…' : '完成引导'}
      </Button>
    </IslandPage>
  );
}
