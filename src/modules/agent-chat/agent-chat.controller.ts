import crypto from 'node:crypto';
import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { env } from '../../config/env';
import { startSse } from '../reel/sse';
import { AgentChatConversation } from './agent-chat-conversation.model';
import { runAgentTurn, AgentChatUserMessage } from './agent-chat.service';

const LOG = '[AgentChat]';

// POST /agent-chat/conversations - starts a new conversation. 503s cleanly
// if OPENAI_API_KEY isn't set yet, rather than the backend failing to boot
// (env.ts declares it optional() for exactly this graceful-degradation path,
// same shape as the Razorpay keys).
export async function startConversation(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!env.openaiApiKey) {
    res.status(503).json({ error: 'Chat assistant is not configured yet' });
    return;
  }

  const conversationId = crypto.randomUUID();
  await AgentChatConversation.create({ conversationId, userId, messages: [], jobState: {} });

  res.status(201).json({ conversationId });
}

// GET /agent-chat/conversations/:conversationId - full history, for page
// reload/resume. The underlying ModelTourJob (if any) is independently
// pollable via GET /model-tour/jobs/:jobId, so a refresh mid-generation
// isn't a dead end even before this resolves.
export async function getConversation(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  const conversationId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!conversationId) {
    res.status(400).json({ error: 'Missing conversationId' });
    return;
  }

  const conversation = await AgentChatConversation.findOne({ conversationId, userId }).lean();
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.status(200).json({ conversation });
}

// POST /agent-chat/conversations/:conversationId/messages - streams the
// assistant's reply as SSE (reusing the same startSse helper every other
// streaming endpoint in this backend uses). Event types: tool_started,
// tool_result, text_delta, done, error - see agent-chat.service.ts.
export async function sendMessage(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  const conversationId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!conversationId) {
    res.status(400).json({ error: 'Missing conversationId' });
    return;
  }
  if (!env.openaiApiKey) {
    res.status(503).json({ error: 'Chat assistant is not configured yet' });
    return;
  }

  const body = req.body ?? {};
  const text = ((body.text as string) || '').toString().trim();
  const avatarImageUrls: string[] = Array.isArray(body.avatarImageUrls)
    ? body.avatarImageUrls.filter((u: unknown) => typeof u === 'string')
    : [];
  const propertyImageUrls: string[] = Array.isArray(body.propertyImageUrls)
    ? body.propertyImageUrls.filter((u: unknown) => typeof u === 'string')
    : [];
  const approvalFor = typeof body.approvalFor === 'string' ? body.approvalFor : undefined;

  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const conversation = await AgentChatConversation.findOne({ conversationId, userId });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const userMessage: AgentChatUserMessage = { text, avatarImageUrls, propertyImageUrls, approvalFor };

  const { send, close } = startSse(req, res);

  try {
    await runAgentTurn(conversation, userId, userMessage, send);
    close();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong';
    console.error(`${LOG} sendMessage error:`, err);
    send({ type: 'error', message });
    close();
  }
}
