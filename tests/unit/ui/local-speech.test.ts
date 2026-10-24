import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSpeechController } from '@/ui/speech/local-speech';

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSpeechSynthesis {
  voices: SpeechSynthesisVoice[] = [];
  spoken: FakeUtterance[] = [];
  cancelCount = 0;
  resumeCount = 0;
  private listeners = new Set<() => void>();
  getVoices() {
    return this.voices;
  }
  addEventListener(type: string, listener: () => void) {
    if (type === 'voiceschanged') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === 'voiceschanged') this.listeners.delete(listener);
  }
  emitVoicesChanged() {
    for (const listener of this.listeners) listener();
  }
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance);
  }
  cancel() {
    this.cancelCount += 1;
  }
  resume() {
    this.resumeCount += 1;
  }
}

function voice(lang: string, localService: boolean, name = lang): SpeechSynthesisVoice {
  return { lang, localService, name, default: false, voiceURI: name } as SpeechSynthesisVoice;
}

function install(synth: FakeSpeechSynthesis | null): void {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Object.defineProperty(window, 'speechSynthesis', {
    value: synth,
    configurable: true,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
  });
}

describe('LocalSpeechController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it('没有 Web Speech API 时显示不支持', () => {
    install(null);
    const controller = new LocalSpeechController();
    controller.initialize();
    expect(controller.getState().status).toBe('unsupported');
  });

  it('只使用本地英语 voice，优先 en-US 并显示实际语言', () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = [
      voice('en-GB', true),
      voice('en-US', false, 'remote'),
      voice('en-US', true, 'local'),
      voice('fr-FR', true),
    ];
    install(synth);
    const controller = new LocalSpeechController();
    controller.initialize();
    expect(controller.getState().status).toBe('idle');
    controller.speak('hello', 'word', 'owner');
    expect(synth.spoken[0]?.text).toBe('hello');
    expect(synth.spoken[0]?.voice?.name).toBe('local');
    expect(controller.getState().voiceLang).toBe('en-US');
    expect(synth.resumeCount).toBe(1);
  });

  it('仅远程 voice 时 3 秒后显示不可用且不朗读', () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = [voice('en-US', false, 'remote')];
    install(synth);
    const controller = new LocalSpeechController();
    controller.initialize();
    expect(controller.getState().status).toBe('waiting-voices');
    vi.advanceTimersByTime(3_000);
    expect(controller.getState().status).toBe('unavailable');
    expect(synth.spoken).toHaveLength(0);
  });

  it('迟到的 voice 只恢复按钮，不自动补播', () => {
    const synth = new FakeSpeechSynthesis();
    install(synth);
    const controller = new LocalSpeechController();
    controller.initialize();
    vi.advanceTimersByTime(3_000);
    expect(controller.getState().status).toBe('unavailable');
    synth.voices = [voice('en-US', true)];
    synth.emitVoicesChanged();
    expect(controller.getState().status).toBe('idle');
    expect(synth.spoken).toHaveLength(0);
  });

  it('5 秒未启动时取消并提示重试', () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = [voice('en-US', true)];
    install(synth);
    const controller = new LocalSpeechController();
    controller.speak('hello', 'word', 'owner');
    expect(controller.getState().status).toBe('preparing');
    vi.advanceTimersByTime(5_000);
    expect(controller.getState().status).toBe('error');
    expect(synth.cancelCount).toBe(1);
  });

  it('启动、结束和停止只影响本插件持有的请求', () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = [voice('en-US', true)];
    install(synth);
    const controller = new LocalSpeechController();
    controller.speak('hello', 'word', 'owner');
    synth.spoken[0]!.onstart?.();
    expect(controller.getState().status).toBe('speaking');
    controller.stopOwnedBy('other-owner');
    expect(controller.getState().status).toBe('speaking');
    controller.stopOwnedBy('owner');
    expect(controller.getState().status).toBe('idle');
    expect(synth.cancelCount).toBe(1);
    synth.spoken[0]!.onend?.();
    expect(controller.getState().status).toBe('idle');
  });
});
