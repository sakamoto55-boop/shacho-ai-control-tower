/**
 * Voice Provider Adapter。音声入出力を特定ベンダーへ密結合させない。
 * 実装候補: OpenAI Realtime / Gemini Live / 将来Provider。
 * 音声が失敗してもテキストチャットは必ず使用可能であること（呼び出し側でフォールバック）。
 */

export interface VoiceTranscription {
  text: string;
  provider: string;
}

export interface VoiceSynthesis {
  /** Phase A はデータURI等を想定したプレースホルダ */
  audioRef: string;
  provider: string;
}

export interface VoiceProvider {
  providerId: string;
  transcribe(audio: ArrayBuffer): Promise<VoiceTranscription>;
  synthesize(text: string): Promise<VoiceSynthesis>;
}

/** 開発・テスト用。音声APIなしでパイプラインの形だけ検証できる */
export class MockVoiceProvider implements VoiceProvider {
  providerId = 'mock';

  async transcribe(): Promise<VoiceTranscription> {
    return { text: '', provider: this.providerId };
  }

  async synthesize(text: string): Promise<VoiceSynthesis> {
    return {
      audioRef: `mock://tts/${encodeURIComponent(text.slice(0, 32))}`,
      provider: this.providerId
    };
  }
}

export function createVoiceProvider(): VoiceProvider {
  // VOICE_PROVIDER 環境変数で切替（Phase Aは mock のみ）
  return new MockVoiceProvider();
}
