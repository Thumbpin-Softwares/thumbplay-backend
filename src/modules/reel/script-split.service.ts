import { callLLM } from './llm.service';

// Port of the script-split LLM call duplicated across all three pipelines -
// identical except the video-style phrase in the prompt (seedance-reel and
// action-reel both use "a fast-paced, high-energy vertical reel video";
// comedy-reel uses "a fast-paced comedy vertical reel video") - passed in as
// `styleLabel` rather than hardcoded.

export interface SplitScriptResult {
  part1: string;
  part2: string;
  part1Words: number;
  part2Words: number;
}

export async function splitScript(script: string, styleLabel: string): Promise<SplitScriptResult> {
  const splitPrompt = `You are a video script editor. Split this real estate ad script into exactly TWO parts for ${styleLabel}.

RULES:
- Part 1 (HOOK ≤40 words): Opening hook. High energy, attention-grabbing, presenter speaks directly to camera. Must end at a natural sentence boundary.
- Part 2 (HIGHLIGHTS + CTA ≤45 words): Property highlights followed by whatever closing/call-to-action line already exists in the script. Do not invent a new CTA - keep the one in the script.
- Do NOT change, add, or remove any words - split at natural sentence boundaries only.
- Return ONLY valid JSON, no markdown: {"part1": "...", "part2": "..."}

SCRIPT:
${script}`;

  let part1 = '';
  let part2 = '';

  try {
    const splitRaw = await callLLM(splitPrompt);
    const jsonMatch = splitRaw
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()
      .match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.part1 && parsed.part2) {
        part1 = parsed.part1.trim();
        part2 = parsed.part2.trim();
      }
    }
  } catch (splitErr) {
    console.warn('[ReelPipeline] LLM split failed, using word-count split:', splitErr instanceof Error ? splitErr.message : splitErr);
  }

  if (!part1 || !part2) {
    const words = script.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    part1 = words.slice(0, mid).join(' ');
    part2 = words.slice(mid).join(' ');
  }

  const part1Words = part1.split(/\s+/).filter(Boolean).length;
  const part2Words = part2.split(/\s+/).filter(Boolean).length;

  return { part1, part2, part1Words, part2Words };
}
