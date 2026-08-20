import { Response } from 'express';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { AuthedRequest } from '../auth/auth.types';
import { uploadToR2, buildUserKey } from '../reel/r2.service';
import { Asset } from '../asset/asset.model';
import { getBundle, renderMediaWithRetry } from './render.service';
import { applyBranding, hasBranding } from './branding.service';

// Matches @remotion/renderer's x264Preset union.
export type X264Preset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'
  | 'placebo';

// Port of the render-remotion route body, parameterized per pipeline - the
// route itself is identical across all three pipelines in the source except
// for the renderMedia option profile, temp filename, R2 key prefix, and
// Asset naming. Two distinct renderMedia profiles exist in the source:
// action-reel/comedy-reel use x264Preset "fast" + a 2-attempt retry wrapper;
// seedance-reel (sourced from luxury-car-exit) uses "ultrafast" +
// concurrency 4 + no retry.
export interface RenderPipelineConfig {
  logLabel: string;
  tempFilePrefix: string;
  r2KeyPrefix: string;
  assetDisplayName: string;
  assetSource: string;
  // Static per-pipeline value, or omitted to fall back to the request's own
  // `inputProps.source` - the generic exports/render-remotion route re-tags
  // whatever pipeline originally produced the asset being re-exported.
  exportedFrom?: string;
  x264Preset: X264Preset;
  concurrency?: number;
  withRetry: boolean;
  // Re-encode the rendered output with a short keyframe interval before
  // upload so it stays frame-accurately seekable if reopened/re-cut again
  // (see reel/video-normalize.service.ts). Only worth it for outputs that
  // are themselves EDITABLE_SOURCES - not final pipeline exports.
  normalizeKeyframes?: boolean;
}

export function createRenderRemotionHandler(config: RenderPipelineConfig) {
  return async function renderRemotion(req: AuthedRequest, res: Response): Promise<void> {
    const userId = req.user?._id?.toString();
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const inputProps = (req.body ?? {}) as Record<string, unknown>;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (obj: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {
        // client likely disconnected - ignore
      }
    };

    try {
      send({ type: 'status', message: 'Bundling…' });
      const serveUrl = await getBundle();

      send({ type: 'status', message: 'Preparing composition…' });
      const composition = await selectComposition({ serveUrl, id: 'ActionReel', inputProps });

      const outputPath = join(tmpdir(), `${config.tempFilePrefix}-${Date.now()}.mp4`);

      send({ type: 'status', message: 'Rendering frames…' });
      const { trimInFrame, trimOutFrame, ...compositionInputProps } = inputProps;
      const frameRange =
        typeof trimInFrame === 'number' &&
        typeof trimOutFrame === 'number' &&
        (trimInFrame > 0 || trimOutFrame < composition.durationInFrames)
          ? ([trimInFrame, trimOutFrame - 1] as [number, number])
          : undefined;

      const renderParams = {
        composition,
        serveUrl,
        codec: 'h264' as const,
        outputLocation: outputPath,
        inputProps: compositionInputProps,
        chromiumOptions: { disableWebSecurity: true },
        x264Preset: config.x264Preset,
        ...(config.concurrency ? { concurrency: config.concurrency } : {}),
        ...(frameRange ? { frameRange } : {}),
        onProgress: ({ progress }: { progress: number }) => {
          send({ type: 'progress', progress: Math.round(progress * 100) });
        },
      };

      if (config.withRetry) {
        await renderMediaWithRetry(renderParams, config.logLabel);
      } else {
        await renderMedia(renderParams);
      }

      send({ type: 'status', message: 'Uploading…' });
      let videoBuf: Buffer = readFileSync(outputPath);
      try {
        unlinkSync(outputPath);
      } catch {
        // ignore
      }

      // Branding is per-generation, not per-account (see branding.service.ts) -
      // these fields ride along on the same request as everything else this
      // export needed. Silently skipped if none were sent, no error, matches
      // this codebase's style for optional features.
      const branding = {
        logoUrl: typeof inputProps.brandingLogoUrl === 'string' ? inputProps.brandingLogoUrl : undefined,
        agencyName: typeof inputProps.brandingAgencyName === 'string' ? inputProps.brandingAgencyName : undefined,
        contactInfo: typeof inputProps.brandingContactInfo === 'string' ? inputProps.brandingContactInfo : undefined,
        primaryColor: typeof inputProps.brandingPrimaryColor === 'string' ? inputProps.brandingPrimaryColor : undefined,
      };
      if (hasBranding(branding)) {
        try {
          send({ type: 'status', message: 'Adding intro/outro…' });
          const mainKey = buildUserKey(userId, 'videos', 'mp4', `${config.r2KeyPrefix}-main-${Date.now()}`);
          const mainUrl = await uploadToR2(videoBuf, mainKey, 'video/mp4');
          const branded = await applyBranding(userId, mainUrl, branding);
          if (branded) videoBuf = branded;
        } catch (err) {
          console.error(`[${config.logLabel} render-remotion] Branding concat failed, using unbranded video:`, err);
        }
      }

      const key = buildUserKey(userId, 'videos', 'mp4', `${config.r2KeyPrefix}-${Date.now()}`);
      const url = await uploadToR2(videoBuf, key, 'video/mp4', config.normalizeKeyframes ? { normalizeKeyframes: true } : {});

      const exportedFrom =
        config.exportedFrom ?? (typeof inputProps.source === 'string' ? inputProps.source : config.assetSource);

      // metadata.source deliberately isn't reopenable as a Remotion
      // composition (it's a flattened mp4) - matches source's convention.
      try {
        await Asset.create({
          userId,
          name: `${config.assetDisplayName} (exported) - ${new Date().toLocaleDateString()}`,
          url,
          type: 'video',
          metadata: { source: config.assetSource, exportedFrom },
        });
      } catch (dbErr) {
        console.error(`[${config.logLabel} render-remotion] DB save error:`, dbErr);
      }

      send({ type: 'done', url });
    } catch (err) {
      console.error(`[${config.logLabel} render-remotion] Error:`, err);
      send({ type: 'error', error: err instanceof Error ? err.message : 'Render failed' });
    } finally {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  };
}
