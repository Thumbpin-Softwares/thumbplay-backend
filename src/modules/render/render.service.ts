import { bundle } from '@remotion/bundler';
import { renderMedia } from '@remotion/renderer';
import { join } from 'node:path';

// Port of the getBundle() caching pattern duplicated across all three
// pipelines' render-remotion routes in the source (each with its own
// module-level cachedBundleUrl) - centralized here as one cache instead.
//
// entryPoint points at the TS/JSX SOURCE file, not a compiled dist path -
// @remotion/bundler runs its own independent webpack build (with its own
// TS/JSX loaders) to produce the Remotion serve bundle, completely separate
// from however this Express server itself was launched (tsx in dev, compiled
// dist/server.js in prod). Same pattern the Next.js source uses (it points
// at src/lib/remotion/index.jsx, never a Next.js build output).
let cachedBundleUrl: string | null = null;

export async function getBundle(): Promise<string> {
  if (cachedBundleUrl) return cachedBundleUrl;
  cachedBundleUrl = await bundle({
    entryPoint: join(process.cwd(), 'src/modules/render/remotion/index.tsx'),
    webpackOverride: (cfg) => cfg,
  });
  return cachedBundleUrl;
}

// renderMedia() fetches each remote video URL fresh when OffthreadVideo's
// frame extractor opens a new clip - a transient connection blip there
// shouldn't fail the whole job when both source videos already exist and
// cost nothing to re-stitch. Only action-reel/comedy-reel use this in the
// source (seedance-reel/luxury-car-exit calls renderMedia directly).
export async function renderMediaWithRetry(
  params: Parameters<typeof renderMedia>[0],
  logLabel: string,
  attempts = 2,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await renderMedia(params);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[${logLabel} render-remotion] renderMedia attempt ${i + 1}/${attempts} failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr;
}
