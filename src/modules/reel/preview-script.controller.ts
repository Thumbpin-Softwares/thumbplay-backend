import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { hasSufficientCreditsForAction } from '../credit/credit.service';
import { synthesizeVoice } from './tts.service';

// Port of action-reel/comedy-reel's preview-script route (byte-identical in
// the source aside from the log prefix) — previews the user's actual typed
// script text. Fully ephemeral (no R2 upload, no DB write), but still gates
// on affordability (read-only check, no deduction) so a 0-credit user can't
// burn real TTS calls on previews they could never actually render.
const MAX_PREVIEW_CHARS = 600;

export function createPreviewScriptHandler(logPrefix: string, creditAction: string = 'action_reel_video') {
  return async function previewScript(req: AuthedRequest, res: Response): Promise<void> {
    const userId = req.user?._id?.toString();
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const affordability = await hasSufficientCreditsForAction({ userId, action: creditAction });
    if (!affordability.ok) {
      res.status(affordability.status).json(affordability.payload);
      return;
    }

    const { text, voiceId, language } = req.body ?? {};
    if (!text || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (!voiceId) {
      res.status(400).json({ error: 'voiceId is required' });
      return;
    }

    const previewText = text.trim().slice(0, MAX_PREVIEW_CHARS);

    try {
      const { buffer, contentType } = await synthesizeVoice({ text: previewText, voiceId, language });
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      console.error(`[${logPrefix}] preview-script failed:`, message);
      res.status(500).json({ error: message });
    }
  };
}
