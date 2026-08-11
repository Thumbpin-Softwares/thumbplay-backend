import { fal } from './fal-client';

// Port of the callLLM helper duplicated across all three reel pipelines'
// generate-pipeline route.js files (identical in each) - script splitting +
// template reproduction both go through this. Primary model via fal.ai's
// openrouter/router proxy; falls back to fal-ai/any-llm on any failure or
// empty output.
export async function callLLM(prompt: string): Promise<string> {
  try {
    const result = await fal.subscribe('openrouter/router', {
      input: { model: 'anthropic/claude-sonnet-4.6', prompt, max_tokens: 2048 },
      logs: false,
    });
    const data = result?.data as { error?: string; output?: string } | undefined;
    if (data?.error) throw new Error(data.error);
    const output = (data?.output ?? (result as { output?: string })?.output ?? '').toString().trim();
    if (output) return output;
    throw new Error('openrouter/router returned empty output');
  } catch (err) {
    console.warn(
      '[ReelPipeline] openrouter/router call failed, falling back to fal-ai/any-llm:',
      err instanceof Error ? err.message : err,
    );
    const fallback = await fal.subscribe('fal-ai/any-llm', {
      input: { model: 'anthropic/claude-3-5-haiku', prompt, max_tokens: 2048 },
    });
    const fallbackData = fallback?.data as { output?: string } | undefined;
    return (fallbackData?.output ?? (fallback as { output?: string })?.output ?? '').toString().trim();
  }
}
