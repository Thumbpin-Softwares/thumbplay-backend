import { callLLM } from './llm.service';

// Port of the "language adaptation" block duplicated identically across all
// three reel pipelines' generate-pipeline route.js files. Bidirectional
// script conversion: Roman-script input in a non-English language gets a
// native-script version for TTS; native-script input gets a Romanized
// version for the Seedance prompt templates (always written in Roman/English
// + #imageN references, regardless of the spoken language).

export const LANGUAGE_NAME_MAP: Record<string, string> = {
  english: 'English',
  hindi: 'Hindi',
  hinglish: 'Hinglish',
  marathi: 'Marathi',
  tamil: 'Tamil',
  telugu: 'Telugu',
  kannada: 'Kannada',
  malayalam: 'Malayalam',
  bengali: 'Bengali',
  gujarati: 'Gujarati',
  punjabi: 'Punjabi',
  urdu: 'Urdu',
  odia: 'Odia',
};

const NATIVE_SCRIPT_RE = /[ऀ-ൿ؀-ۿ]/;

const NATIVE_SCRIPT_RULE: Record<string, string> = {
  hindi: 'Convert every Hindi/Urdu word to Devanagari script.',
  hinglish: 'Convert every Hindi/Urdu word to Devanagari script. English words stay in Roman exactly as written.',
  marathi: 'Convert every Marathi word to Devanagari script. Any English word or phrase stays in Roman exactly as written.',
  bengali: 'Convert every Bengali word to Bengali script (বাংলা). Any English word or phrase stays in Roman exactly as written.',
  gujarati: 'Convert every Gujarati word to Gujarati script (ગુજરાતી). Any English word or phrase stays in Roman exactly as written.',
  punjabi: 'Convert every Punjabi word to Gurmukhi script (ਪੰਜਾਬੀ). Any English word or phrase stays in Roman exactly as written.',
  urdu: 'Convert every Urdu word to Nastaliq Urdu script. Any English word or phrase stays in Roman exactly as written.',
  odia: 'Convert every Odia word to Odia script (ଓଡ଼ିଆ). Any English word or phrase stays in Roman exactly as written.',
  tamil: 'Convert every Tamil word to Tamil script (தமிழ்). Any English word or phrase stays in Roman exactly as written.',
  telugu: 'Convert every Telugu word to Telugu script (తెలుగు). Any English word or phrase stays in Roman exactly as written.',
  kannada: 'Convert every Kannada word to Kannada script (ಕನ್ನಡ). Any English word or phrase stays in Roman exactly as written.',
  malayalam: 'Convert every Malayalam word to Malayalam script (മലയാളം). Any English word or phrase stays in Roman exactly as written.',
};

export interface AdaptedParts {
  part1_tts: string;
  part2_tts: string;
  part1_roman: string;
  part2_roman: string;
}

export interface AdaptScriptPartsInput {
  part1: string;
  part2: string;
  language: string;
  onStatus?: (message: string) => void;
}

function extractJson(raw: string): Record<string, string> | null {
  const match = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
    .match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function adaptScriptParts({ part1, part2, language, onStatus }: AdaptScriptPartsInput): Promise<AdaptedParts> {
  let part1_tts = part1;
  let part2_tts = part2;
  let part1_roman = part1;
  let part2_roman = part2;

  if (language === 'english') {
    return { part1_tts, part2_tts, part1_roman, part2_roman };
  }

  const langName = LANGUAGE_NAME_MAP[language] || 'English';
  const part1HasNativeScript = NATIVE_SCRIPT_RE.test(part1);
  const rule = NATIVE_SCRIPT_RULE[language];

  if (!part1HasNativeScript && rule) {
    onStatus?.(`Converting both parts to ${langName} for TTS…`);
    try {
      const adaptPrompt = `You are a script localisation tool. The following ${langName} text is in Roman transliteration.

TASK: Convert BOTH parts to proper native script for text-to-speech.
RULE: ${rule}
IMPORTANT: Do NOT translate. Do NOT change any words. Only change the writing system.
Return ONLY valid JSON (no markdown):
{"part1": "...", "part2": "..."}

PART 1:
${part1}

PART 2:
${part2}`;
      const parsed = extractJson(await callLLM(adaptPrompt));
      const allValid = (parsed?.part1?.trim().length ?? 0) > 5 && (parsed?.part2?.trim().length ?? 0) > 5;
      if (parsed && allValid) {
        part1_tts = parsed.part1!.trim();
        part2_tts = parsed.part2!.trim();
      } else if (parsed) {
        console.warn('[ReelPipeline] Roman→native conversion incomplete - keeping both parts in Roman for consistency:', parsed);
      }
    } catch (err) {
      console.warn('[ReelPipeline] Roman→native conversion failed:', err instanceof Error ? err.message : err);
    }
  } else if (part1HasNativeScript) {
    onStatus?.('Transliterating both parts to Roman for Seedance prompts…');
    try {
      const romanizePrompt = `Transliterate the following ${langName} texts from native script to Romanized Latin letters. Keep English brand names and numbers unchanged.
Return ONLY valid JSON (no markdown):
{"part1_roman": "...", "part2_roman": "..."}

TEXT 1:
${part1}

TEXT 2:
${part2}`;
      const parsed = extractJson(await callLLM(romanizePrompt));
      if ((parsed?.part1_roman?.trim().length ?? 0) > 5) part1_roman = parsed!.part1_roman!.trim();
      if ((parsed?.part2_roman?.trim().length ?? 0) > 5) part2_roman = parsed!.part2_roman!.trim();
    } catch (err) {
      console.warn('[ReelPipeline] Native→Roman transliteration failed:', err instanceof Error ? err.message : err);
    }
  }

  return { part1_tts, part2_tts, part1_roman, part2_roman };
}
