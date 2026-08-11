import { fal } from './fal-client';
import { env } from '../../config/env';
import { ELEVENLABS_VOICE_SETTINGS } from './elevenlabs-config';
import { SARVAM_MODEL, SARVAM_LANGUAGE_CODES } from './sarvam-config';

// Port of thumbpinclient/src/lib/voice-tts.js - identical across all three
// reel pipelines in the source (not action-reel-specific, as earlier assumed).

const SARVAM_PREFIX = 'sarvam:';
const DEFAULT_ELEVENLABS_VOICE_ID = 'dVTC43Yewy5fAIcmsISI';

export function isSarvamVoice(voiceId: string): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith(SARVAM_PREFIX);
}

export interface SynthesizedVoice {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

async function synthesizeElevenLabs(text: string, voiceId: string): Promise<SynthesizedVoice> {
  // Non-null: DEFAULT_ELEVENLABS_VOICE_ID is a known-present key in the map.
  const vs = ELEVENLABS_VOICE_SETTINGS[voiceId] ?? ELEVENLABS_VOICE_SETTINGS[DEFAULT_ELEVENLABS_VOICE_ID]!;
  const result = await fal.subscribe('fal-ai/elevenlabs/tts/multilingual-v2', {
    input: {
      text,
      voice: voiceId,
      stability: vs.stability,
      similarity_boost: vs.similarity_boost,
      style: vs.style,
      speed: vs.speed,
    },
    logs: false,
  });
  const data = result?.data as { audio_url?: string; audio?: { url?: string } } | undefined;
  const audioUrl = data?.audio_url || data?.audio?.url;
  if (!audioUrl) throw new Error('ElevenLabs returned no audio URL');

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Failed to download ElevenLabs audio: ${res.status}`);

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: 'audio/mpeg',
    ext: 'mp3',
  };
}

async function synthesizeSarvam(text: string, voiceId: string, language: string): Promise<SynthesizedVoice> {
  const speaker = voiceId.slice(SARVAM_PREFIX.length);
  const targetLanguageCode = SARVAM_LANGUAGE_CODES[language] || 'en-IN';

  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': env.sarvamApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      speaker,
      target_language_code: targetLanguageCode,
      model: SARVAM_MODEL,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Sarvam TTS failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { audios?: string[] };
  const base64Audio = data?.audios?.[0];
  if (!base64Audio) throw new Error('Sarvam returned no audio');

  return {
    buffer: Buffer.from(base64Audio, 'base64'),
    contentType: 'audio/wav',
    ext: 'wav',
  };
}

export interface SynthesizeVoiceInput {
  text: string;
  voiceId: string;
  language: string;
}

// Routes to Sarvam or ElevenLabs based on the voiceId's provider prefix -
// callers pick a voice from the combined catalog without needing to know
// which provider it belongs to.
export async function synthesizeVoice({ text, voiceId, language }: SynthesizeVoiceInput): Promise<SynthesizedVoice> {
  if (isSarvamVoice(voiceId)) {
    return synthesizeSarvam(text, voiceId, language);
  }
  return synthesizeElevenLabs(text, voiceId);
}
