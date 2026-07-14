import { callLLM } from './llm.service';

// Generic engine behind each pipeline's master-template reproduction —
// identical control flow across all three pipelines (LLM reproduce →
// validate → deterministic fallback). Each pipeline supplies its own
// `buildPrompt` since comedy-reel's version has genuinely different wording
// (distinguishing spoken dialogue from a stage-direction gesture), plus its
// own template text / markers / fallback fill function.

export function isValidReproduction(text: string, markers: string[]): boolean {
  if (!text || text.length < 200) return false;
  if (!/\[0:0/.test(text)) return false;
  return markers.every((m) => text.includes(m));
}

// Even word-count chunking with backfill for empty chunks (short dialogue
// split into more beats than it has words for).
export function splitWordsIntoChunks(text: string, n: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunkSize = Math.max(1, Math.ceil(words.length / n));
  const chunks: string[] = [];
  for (let i = 0; i < n; i++) {
    chunks.push(words.slice(i * chunkSize, (i + 1) * chunkSize).join(' '));
  }
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) chunks[i] = chunks.slice(0, i).reverse().find(Boolean) || words.join(' ');
  }
  return chunks;
}

export interface ReproduceTemplateInput {
  template: string;
  markers: string[];
  dialogue: string;
  partLabel: string;
  fallbackFn: (dialogue: string) => string;
  buildPrompt: (args: { masterTemplate: string; dialogue: string; partLabel: string }) => string;
  logPrefix: string;
}

export async function reproduceTemplate({
  template,
  markers,
  dialogue,
  partLabel,
  fallbackFn,
  buildPrompt,
  logPrefix,
}: ReproduceTemplateInput): Promise<string> {
  try {
    const raw = await callLLM(buildPrompt({ masterTemplate: template, dialogue, partLabel }));
    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .replace(/^(here'?s the prompt:?|prompt:)\s*/i, '')
      .trim();
    if (isValidReproduction(cleaned, markers)) return cleaned;
    console.warn(`[${logPrefix}] ${partLabel} reproduction failed validation, using fallback template.`);
  } catch (err) {
    console.warn(`[${logPrefix}] ${partLabel} reproduction LLM call failed:`, err instanceof Error ? err.message : err);
  }
  return fallbackFn(dialogue);
}
