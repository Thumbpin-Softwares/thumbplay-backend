import { fal } from '@fal-ai/client';
import { env } from '../../config/env';

// Configured once at import time — reused by tts.service.ts, llm.service.ts,
// and each pipeline's Seedance calls.
fal.config({ credentials: env.falKey });

export { fal };
