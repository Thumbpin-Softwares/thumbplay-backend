import { Router } from 'express';
import { startConversation, getConversation, sendMessage } from './agent-chat.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /agent-chat/conversations:
 *   post:
 *     summary: Start a new agentic chat conversation for the storyboard->scenes->combine flow
 *     description: >
 *       Returns 503 if OPENAI_API_KEY isn't configured yet - this is the one direct (non-fal.ai,
 *       non-n8n) model call in this backend, needed for real tool-calling and token streaming
 *       that fal.ai's openrouter/router wrapper can't do.
 *     tags: [Agent Chat]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: "{ conversationId }"
 *       401:
 *         description: Not authenticated
 *       503:
 *         description: Chat assistant not configured
 */
router.post('/conversations', requireAuth, startConversation);

/**
 * @openapi
 * /agent-chat/conversations/{conversationId}:
 *   get:
 *     summary: Get a conversation's full message history
 *     tags: [Agent Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The conversation document
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Conversation not found
 */
router.get('/conversations/:conversationId', requireAuth, getConversation);

/**
 * @openapi
 * /agent-chat/conversations/{conversationId}/messages:
 *   post:
 *     summary: Send a message and stream the assistant's reply
 *     description: >
 *       Streams progress as Server-Sent Events (tool_started, tool_result, text_delta, done,
 *       error). `approvalFor` must be set to `generate_video_scenes` or `combine_video` to let
 *       the corresponding gated tool actually execute on this turn.
 *     tags: [Agent Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string }
 *               avatarImageUrls: { type: array, items: { type: string } }
 *               propertyImageUrls: { type: array, items: { type: string } }
 *               approvalFor: { type: string, enum: [generate_video_scenes, combine_video] }
 *     responses:
 *       200:
 *         description: text/event-stream of the assistant's reply
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Conversation not found
 *       503:
 *         description: Chat assistant not configured
 */
router.post('/conversations/:conversationId/messages', requireAuth, sendMessage);

export default router;
