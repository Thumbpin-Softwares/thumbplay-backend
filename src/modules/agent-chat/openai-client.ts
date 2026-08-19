import OpenAI from 'openai';
import { env } from '../../config/env';

// Module-level singleton, same pattern as reel/fal-client.ts's `fal` export.
// Constructing with an empty key is fine (the SDK doesn't validate eagerly) -
// agent-chat.controller.ts's conversation-start endpoint is what actually
// gates on env.openaiApiKey being set, before this client is ever used.
export const openai = new OpenAI({ apiKey: env.openaiApiKey || 'unset' });
