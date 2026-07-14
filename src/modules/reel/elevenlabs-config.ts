// Verbatim port of thumbpinclient/src/lib/elevenlabs-config.js.

export interface ElevenLabsVoice {
  id: string;
  label: string;
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: 'dVTC43Yewy5fAIcmsISI', label: 'Anvi (Female)' },
  { id: 'K2Byg54sHB1oHegvENtI', label: 'Kanika (Female)' },
  { id: '7b9mYhmnp0y2qSH1FnBL', label: 'Bunty (Male)' },
  { id: 'JS6C6yu2x9Byh4i1a8lX', label: 'Meher (Female)' },
  { id: 'DdD5pVl1QDeeI6MMtYbk', label: 'Abhay (Male)' },
];

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
}

export const ELEVENLABS_VOICE_SETTINGS: Record<string, ElevenLabsVoiceSettings> = {
  dVTC43Yewy5fAIcmsISI: { stability: 0.52, similarity_boost: 0.8, style: 0.63, speed: 0.94 }, // Anvi (Female)
  K2Byg54sHB1oHegvENtI: { stability: 0.28, similarity_boost: 0.2, style: 0.3, speed: 1.2 }, // Kanika (Female)
  '7b9mYhmnp0y2qSH1FnBL': { stability: 0.24, similarity_boost: 0.08, style: 0.3, speed: 1.22 }, // Bunty (Male)
  JS6C6yu2x9Byh4i1a8lX: { stability: 0.44, similarity_boost: 0.4, style: 0.3, speed: 1.5 }, // Meher (Female)
  DdD5pVl1QDeeI6MMtYbk: { stability: 0.22, similarity_boost: 0.1, style: 0.3, speed: 1.12 }, // Abhay (Male)
};

export const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
