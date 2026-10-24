import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExampleSpeechPanel,
  SPEECH_CONTROLS_CSS,
  SpeechControls,
} from '@/ui/speech/SpeechControls';

const speechMock = vi.hoisted(() => ({
  state: {
    status: 'idle',
    ownerId: null as string | null,
    label: null as 'word' | 'example' | null,
    voiceLang: null as string | null,
    message: null as string | null,
  },
  isSpeaking: vi.fn<(label: 'word' | 'example') => boolean>(() => false),
  speak: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/ui/speech/local-speech', () => ({
  useLocalSpeech: () => speechMock,
}));

beforeEach(() => {
  Object.assign(speechMock.state, {
    status: 'idle',
    ownerId: null,
    label: null,
    voiceLang: null,
    message: null,
  });
  speechMock.isSpeaking.mockReset().mockReturnValue(false);
  speechMock.speak.mockReset();
  speechMock.stop.mockReset();
  speechMock.retry.mockReset();
});

describe('SpeechControls', () => {
  it('单词朗读保留有框紧凑按钮，点击朗读单词', () => {
    render(<SpeechControls ownerId="owner" wordText="abandon" phonetic="/əˈbændən/" />);

    const button = screen.getByRole('button', { name: '系统朗读单词' });
    expect(button.className).toContain('animal-btn-default');
    expect(button.className).toContain('bingeup-speech-icon-button');
    expect(screen.getByText('/əˈbændən/')).toBeInTheDocument();

    fireEvent.click(button);
    expect(speechMock.speak).toHaveBeenCalledWith('abandon', 'word');
  });

  it('单词朗读中再次点击会停止', () => {
    speechMock.isSpeaking.mockReturnValue(true);
    render(<SpeechControls ownerId="owner" wordText="abandon" />);

    fireEvent.click(screen.getByRole('button', { name: '停止朗读单词' }));
    expect(speechMock.stop).toHaveBeenCalledOnce();
    expect(speechMock.speak).not.toHaveBeenCalled();
  });

  it('整块例句区域可用鼠标、Enter 和 Space 朗读，且不嵌套按钮', () => {
    const { container } = render(
      <ExampleSpeechPanel ownerId="owner" exampleText="Plants absorb sunlight.">
        <p>Plants absorb sunlight.</p>
        <p>植物吸收阳光。</p>
      </ExampleSpeechPanel>,
    );
    const example = screen.getByRole('button', { name: '朗读例句' });

    expect(example).toHaveClass('bingeup-example-action');
    expect(example.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('.bingeup-example-speaker')).toBeInTheDocument();
    expect(example).toHaveTextContent('Plants absorb sunlight.');
    expect(example).toHaveTextContent('植物吸收阳光。');

    fireEvent.click(example);
    expect(speechMock.speak).toHaveBeenLastCalledWith('Plants absorb sunlight.', 'example');
    expect(fireEvent.keyDown(example, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(example, { key: ' ' })).toBe(false);
    expect(speechMock.speak).toHaveBeenCalledTimes(3);
  });

  it('朗读中的例句区域再次点击会停止', () => {
    speechMock.isSpeaking.mockReturnValue(true);
    render(
      <ExampleSpeechPanel ownerId="owner" exampleText="Plants absorb sunlight.">
        <p>Plants absorb sunlight.</p>
      </ExampleSpeechPanel>,
    );

    fireEvent.click(screen.getByRole('button', { name: '停止朗读例句' }));
    expect(speechMock.stop).toHaveBeenCalledOnce();
    expect(speechMock.speak).not.toHaveBeenCalled();
  });

  it('拖选例句文字不会误触朗读', () => {
    const { container } = render(
      <ExampleSpeechPanel ownerId="owner" exampleText="Plants absorb sunlight.">
        <p>Plants absorb sunlight.</p>
      </ExampleSpeechPanel>,
    );
    const text = container.querySelector('p')?.firstChild;
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'absorb',
      anchorNode: text,
    } as unknown as Selection);

    fireEvent.click(screen.getByRole('button', { name: '朗读例句' }));
    expect(speechMock.speak).not.toHaveBeenCalled();
    getSelection.mockRestore();
  });

  it('朗读不可用时显示简短状态和重试', () => {
    speechMock.state.status = 'unavailable';
    render(
      <ExampleSpeechPanel ownerId="owner" exampleText="Plants absorb sunlight.">
        <p>Plants absorb sunlight.</p>
      </ExampleSpeechPanel>,
    );

    expect(screen.getByText('本地朗读不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(speechMock.retry).toHaveBeenCalledOnce();
  });

  it('样式使用令牌、单色图标、可选中文字且例句区域无额外留白', () => {
    expect(SPEECH_CONTROLS_CSS).toContain('var(--animal-text-color-secondary)');
    expect(SPEECH_CONTROLS_CSS).toContain('path { fill: currentColor; stroke: currentColor; }');
    expect(SPEECH_CONTROLS_CSS).toContain('user-select: text');
    expect(SPEECH_CONTROLS_CSS).toContain('padding: 9px 11px');
    expect(SPEECH_CONTROLS_CSS).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
