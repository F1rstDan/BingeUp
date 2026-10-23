import { useEffect, useSyncExternalStore } from 'react';

export type SpeechLabel = 'word' | 'example';
export type LocalSpeechStatus =
  'idle' | 'unsupported' | 'waiting-voices' | 'unavailable' | 'preparing' | 'speaking' | 'error';

export interface LocalSpeechState {
  status: LocalSpeechStatus;
  /** 当前请求属于哪个界面实例。 */
  ownerId: string | null;
  label: SpeechLabel | null;
  /** 实际选中的本地英语语音语言。 */
  voiceLang: string | null;
  message: string | null;
}

const INITIAL_STATE: LocalSpeechState = {
  status: 'idle',
  ownerId: null,
  label: null,
  voiceLang: null,
  message: null,
};

const VOICE_WAIT_MS = 3_000;
const START_TIMEOUT_MS = 5_000;

/** 只使用本地英语系统语音；不调用远程服务、不使用默认 voice。 */
export class LocalSpeechController {
  private state: LocalSpeechState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private initialized = false;
  private voiceTimer: number | null = null;
  private startTimer: number | null = null;
  private token = 0;
  private owned = false;
  private pagehideBound = false;

  getState = (): LocalSpeechState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(next: Partial<LocalSpeechState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private bindPagehide(): void {
    if (this.pagehideBound || typeof window === 'undefined') return;
    this.pagehideBound = true;
    window.addEventListener('pagehide', () => this.stopOwned());
  }

  initialize(): void {
    this.bindPagehide();
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.setState({ status: 'unsupported', message: '当前浏览器不支持系统朗读。' });
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      this.setState({ status: 'unsupported', message: '当前浏览器不支持系统朗读。' });
      return;
    }
    this.synth = synth;
    synth.addEventListener?.('voiceschanged', this.handleVoicesChanged);
    this.refreshVoices();
  }

  private handleVoicesChanged = (): void => {
    const previous = this.state.status;
    this.refreshVoices();
    // 迟到 voice 只恢复按钮，不自动补播旧请求。
    if (this.voices.length > 0 && (previous === 'waiting-voices' || previous === 'unavailable')) {
      this.setState({ status: 'idle', message: null });
    }
  };

  private refreshVoices(): void {
    if (!this.synth) return;
    const all = this.synth.getVoices?.() ?? [];
    this.voices = all
      .filter((voice) => voice.localService === true && /^en(?:-|$)/i.test(voice.lang || ''))
      .sort((a, b) => {
        const rank = (voice: SpeechSynthesisVoice) =>
          /^en-US$/i.test(voice.lang) ? 0 : /^en[-_]?GB$/i.test(voice.lang) ? 1 : 2;
        return rank(a) - rank(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
      });
    if (this.voices.length > 0) {
      if (this.voiceTimer !== null) window.clearTimeout(this.voiceTimer);
      this.voiceTimer = null;
      if (this.state.status === 'waiting-voices' || this.state.status === 'unavailable') {
        this.setState({ status: 'idle', message: null });
      }
      return;
    }
    if (this.state.status === 'preparing' || this.state.status === 'speaking') return;
    this.setState({ status: 'waiting-voices', message: '正在查找本地英语语音…' });
    if (this.voiceTimer === null) {
      this.voiceTimer = window.setTimeout(() => {
        this.voiceTimer = null;
        if (this.voices.length === 0) {
          this.setState({
            status: 'unavailable',
            message: '没有可用的本地英语语音；学习仍可继续。',
          });
        }
      }, VOICE_WAIT_MS);
    }
  }

  private clearTimers(): void {
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  /** 只停止本插件持有的请求；其他页面或插件的朗读不受影响。 */
  stopOwned(): void {
    if (!this.owned) return;
    this.token += 1;
    this.owned = false;
    this.clearTimers();
    try {
      this.synth?.cancel();
    } catch {
      // 浏览器拒绝取消时仍清理本地状态。
    }
    this.setState({ status: 'idle', ownerId: null, label: null, message: null });
  }

  stopOwnedBy(ownerId: string): void {
    if (this.state.ownerId === ownerId) this.stopOwned();
  }

  retry(): void {
    this.initialize();
    this.refreshVoices();
    if (this.voices.length > 0) this.setState({ status: 'idle', message: null });
  }

  speak(text: string, label: SpeechLabel, ownerId: string): boolean {
    this.initialize();
    this.refreshVoices();
    if (!this.synth) return false;
    if (this.voices.length === 0) {
      this.setState({ status: 'unavailable', message: '没有可用的本地英语语音；学习仍可继续。' });
      return false;
    }
    this.stopOwned();
    const voice = this.voices[0]!;
    const token = ++this.token;
    this.owned = true;
    this.clearTimers();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 1;
    utterance.onstart = () => {
      if (token !== this.token) return;
      this.clearTimers();
      this.setState({ status: 'speaking', message: null });
    };
    utterance.onend = () => {
      if (token !== this.token) return;
      this.owned = false;
      this.clearTimers();
      this.setState({ status: 'idle', ownerId: null, label: null, message: null });
    };
    utterance.onerror = (event) => {
      if (token !== this.token) return;
      this.owned = false;
      this.clearTimers();
      if (event.error === 'canceled' || event.error === 'interrupted') {
        this.setState({ status: 'idle', ownerId: null, label: null, message: null });
      } else {
        this.setState({ status: 'error', message: '朗读失败，请重试。' });
      }
    };
    this.setState({
      status: 'preparing',
      ownerId,
      label,
      voiceLang: voice.lang,
      message: '正在准备系统朗读…',
    });
    this.startTimer = window.setTimeout(() => {
      if (token !== this.token || this.state.status !== 'preparing') return;
      this.owned = false;
      this.token += 1;
      try {
        this.synth?.cancel();
      } catch {
        // 忽略取消失败，仍显示可重试状态。
      }
      this.setState({
        status: 'error',
        ownerId: null,
        label: null,
        message: '朗读未启动，请重试。',
      });
    }, START_TIMEOUT_MS);
    try {
      this.synth.speak(utterance);
    } catch {
      this.owned = false;
      this.clearTimers();
      this.setState({ status: 'error', message: '朗读失败，请重试。' });
      return false;
    }
    return true;
  }

  dispose(): void {
    this.stopOwned();
    if (this.voiceTimer !== null) window.clearTimeout(this.voiceTimer);
    this.voiceTimer = null;
    this.synth?.removeEventListener?.('voiceschanged', this.handleVoicesChanged);
    this.listeners.clear();
  }
}

export const localSpeech = new LocalSpeechController();

export function useLocalSpeech(ownerId: string): {
  state: LocalSpeechState;
  isSpeaking: (label: SpeechLabel) => boolean;
  speak: (text: string, label: SpeechLabel) => void;
  stop: () => void;
  retry: () => void;
} {
  const state = useSyncExternalStore(
    localSpeech.subscribe,
    localSpeech.getState,
    localSpeech.getState,
  );
  useEffect(() => {
    localSpeech.initialize();
    return () => localSpeech.stopOwnedBy(ownerId);
  }, [ownerId]);
  return {
    state,
    isSpeaking: (label) =>
      state.ownerId === ownerId &&
      state.label === label &&
      (state.status === 'preparing' || state.status === 'speaking'),
    speak: (text, label) => {
      localSpeech.speak(text, label, ownerId);
    },
    stop: () => localSpeech.stopOwnedBy(ownerId),
    retry: () => localSpeech.retry(),
  };
}
