import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { createRenderRemotionHandler } from '../render/render.controller';

const router: Router = Router();

// Shared re-export endpoint for the "isFlatExport" EDITABLE_SOURCES entries
// on thumbpinclient (see src/lib/editable-sources.js) — reopening an
// already-exported reel (from any original pipeline) is always a
// single-clip "ActionReel" composition (part1 only), so one generic route
// covers all of them. Matches the source's x264Preset "ultrafast" +
// concurrency 4 + no retry profile, and (unlike the per-pipeline final
// exports) re-normalizes keyframes on upload since a "video-export" is
// itself reopenable/re-cuttable again via this same route.
const renderRemotion = createRenderRemotionHandler({
  logLabel: 'Exports',
  tempFilePrefix: 'video-export',
  r2KeyPrefix: 'video-export',
  assetDisplayName: 'Video',
  assetSource: 'video-export',
  x264Preset: 'ultrafast',
  concurrency: 2,
  withRetry: false,
  normalizeKeyframes: true,
});

/**
 * @openapi
 * /exports/render-remotion:
 *   post:
 *     summary: Re-render a trimmed/edited clip from the manual editor (any EDITABLE_SOURCES origin)
 *     description: >
 *       Streams progress as Server-Sent Events (status/progress/done/error). Always
 *       renders the single-clip "ActionReel" composition (part1 only) — used both for
 *       fresh exports out of the editor and for re-exporting an already-exported clip.
 *     tags: [Exports]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               source: { type: string, description: "Original EDITABLE_SOURCES key this clip came from, tagged as metadata.exportedFrom" }
 *               part1VideoUrl: { type: string }
 *               part1Duration: { type: number, example: 15 }
 *               trimInFrame: { type: number }
 *               trimOutFrame: { type: number }
 *     responses:
 *       200:
 *         description: text/event-stream of render progress events
 *       401:
 *         description: Not authenticated
 */
router.post('/render-remotion', requireAuth, renderRemotion);

export default router;
