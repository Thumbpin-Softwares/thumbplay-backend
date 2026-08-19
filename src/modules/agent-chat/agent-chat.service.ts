import crypto from 'node:crypto';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { openai } from './openai-client';
import { env } from '../../config/env';
import {
  generateModelTourScript,
  generateChunks,
  regenerateChunk,
  combineChunksAndHandoff,
  OmniHomeTourInput,
  PropertyType,
} from '../model-tour/model-tour.service';
import { ModelTourJob } from '../model-tour/model-tour-job.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { IAgentChatConversation } from './agent-chat-conversation.model';

const LOG = '[AgentChat]';
const REAL_ESTATE_VIDEO_CREDIT_ACTION = 'real_estate_video';
const CHUNK_REGEN_CREDIT_ACTION = 'model_tour_chunk_regeneration';
const PROPERTY_TYPES = new Set<PropertyType>(['residential', 'commercial', 'plotted']);

// The two hard-to-undo, credit-charging steps - everything else (proposing a
// storyboard, regenerating one named scene) is either free or a small,
// directly-requested correction that doesn't need a separate confirm.
const GATED_TOOLS = new Set(['generate_video_scenes', 'combine_video']);

const SYSTEM_PROMPT = `You are the ad-creation assistant for a real-estate video platform. You help a user turn a property description and some photos into a finished home-tour video, entirely through this conversation.

Flow:
1. Collect: property name, at least one avatar/presenter photo URL, at least one property photo URL, and enough descriptive detail (type, location, connectivity, language, tier class, carpet area, amenities, tonality/vibe) OR a manual script the user wrote themselves. Ask for whatever's missing - don't guess property details.
2. Once you have enough, call propose_storyboard. Present what comes back conversationally and ask the user to approve it or tell you what to change. The frontend already renders the 6 scenes as cards - don't re-list every scene's full text back at the user, just summarize briefly and ask for approval.
3. Only call generate_video_scenes after the user has clearly approved the storyboard. If they haven't approved yet, ask - don't call it speculatively.
4. Once scenes are generated, the frontend shows all 6 as video cards with per-scene regenerate buttons. If the user says a specific scene looks wrong, call regenerate_scene with that scene's number directly - naming it IS the approval, no extra confirmation needed.
5. Only call combine_video after the user has clearly approved moving to the final combine step.
6. If you try a gated action without approval, you'll get an error back explaining that - when that happens, just ask the user to confirm, don't retry immediately.

Keep replies short and conversational. You're guiding, not writing documentation.`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_storyboard',
      description:
        "Propose a 6-scene video storyboard for the property, based on details and photos the user has shared. Call this once you have a property name and at least one avatar photo URL and one property photo URL - ask for anything missing first, don't call this with incomplete info.",
      parameters: {
        type: 'object',
        properties: {
          propertyName: { type: 'string' },
          type: { type: 'string', enum: ['residential', 'commercial', 'plotted'] },
          locationLandmarks: { type: 'string' },
          connectivity: { type: 'string' },
          language: { type: 'string' },
          tierClass: { type: 'string' },
          carpetArea: { type: 'string' },
          amenities: { type: 'string' },
          tonality: { type: 'string' },
          vibe: { type: 'string' },
          avatarImageUrls: { type: 'array', items: { type: 'string' }, description: 'URLs of presenter/avatar photos the user attached' },
          propertyImageUrls: { type: 'array', items: { type: 'string' }, description: 'URLs of property photos the user attached' },
          script: { type: 'string', description: 'Optional - a full manual voiceover script if the user wrote/pasted their own instead' },
        },
        required: ['propertyName', 'avatarImageUrls', 'propertyImageUrls'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_video_scenes',
      description:
        'Generate all 6 video scenes from the approved storyboard. ONLY call this after the user has explicitly approved the storyboard.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'regenerate_scene',
      description:
        'Regenerate exactly one scene the user pointed out as not good. Call this directly when the user names a specific scene to redo - no separate approval needed.',
      parameters: {
        type: 'object',
        properties: { chunkIndex: { type: 'integer', minimum: 1, maximum: 6, description: '1-based scene number to regenerate' } },
        required: ['chunkIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'combine_video',
      description:
        'Combine the current 6 scenes (including any regenerated ones) into the final video. ONLY call this after the user has explicitly approved moving to the final combine step.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

async function executeProposeStoryboard(conversation: IAgentChatConversation, _userId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const avatarImageUrls = Array.isArray(args.avatarImageUrls) ? (args.avatarImageUrls as string[]) : [];
  const propertyImageUrls = Array.isArray(args.propertyImageUrls) ? (args.propertyImageUrls as string[]) : [];
  if (avatarImageUrls.length === 0 || propertyImageUrls.length === 0) {
    return { ok: false, error: 'At least one avatar photo and one property photo are needed before a storyboard can be proposed.' };
  }

  const typeArg = (args.type as string) || '';
  const input: OmniHomeTourInput = {
    propertyName: (args.propertyName as string) || 'Untitled Property',
    ...(PROPERTY_TYPES.has(typeArg as PropertyType) ? { type: typeArg as PropertyType } : {}),
    locationLandmarks: (args.locationLandmarks as string) || '',
    connectivity: (args.connectivity as string) || '',
    language: (args.language as string) || '',
    tierClass: (args.tierClass as string) || '',
    carpetArea: (args.carpetArea as string) || '',
    amenities: (args.amenities as string) || '',
    tonality: (args.tonality as string) || '',
    vibe: (args.vibe as string) || '',
    avatarImageUrls,
    propertyImageUrls,
    ...(args.script ? { script: args.script as string } : {}),
  };

  const script = await generateModelTourScript(input);
  conversation.jobState = { ...conversation.jobState, script };
  await conversation.save();

  const storyboard = Array.isArray(script.storyboard) ? script.storyboard : [];
  return { ok: true, data: { storyboard } };
}

async function executeGenerateVideoScenes(conversation: IAgentChatConversation, userId: string): Promise<ToolResult> {
  const script = conversation.jobState?.script;
  if (!script) {
    return { ok: false, error: 'No storyboard has been proposed yet - call propose_storyboard first.' };
  }

  const jobId = crypto.randomUUID();
  let debit: ConsumeDebit | undefined;
  try {
    const creditResult = await consumeCreditsForAction({
      userId,
      action: REAL_ESTATE_VIDEO_CREDIT_ACTION,
      metadata: { endpoint: 'agent-chat', conversationId: conversation.conversationId, jobId },
    });
    if (!creditResult.ok) {
      return { ok: false, error: 'insufficient_credits' };
    }
    debit = creditResult.debit;

    const propertyName = ((script.property_name ?? script.propertyName ?? 'Untitled Property') as string).toString();
    await ModelTourJob.create({ jobId, userId, propertyName, status: 'running', inputs: script });

    const chunks = await generateChunks(jobId, userId, script);
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'chunks_ready', chunks } });

    conversation.jobState = { ...conversation.jobState, modelTourJobId: jobId };
    await conversation.save();

    return { ok: true, data: { jobId, chunks } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scene generation failed';
    console.error(`${LOG} generate_video_scenes error:`, err);
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'error', error: message } }).catch(() => {});
    if (debit) {
      await refundCreditsForAction({
        userId,
        action: REAL_ESTATE_VIDEO_CREDIT_ACTION,
        debit,
        metadata: { conversationId: conversation.conversationId, jobId, reason: 'generation_failed', message },
      });
    }
    return { ok: false, error: message };
  }
}

async function executeRegenerateScene(conversation: IAgentChatConversation, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const chunkIndex = Number(args.chunkIndex);
  const jobId = conversation.jobState?.modelTourJobId;
  const script = conversation.jobState?.script;
  if (!jobId || !script) {
    return { ok: false, error: 'No scenes have been generated yet.' };
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 1 || chunkIndex > 6) {
    return { ok: false, error: 'chunkIndex must be an integer from 1 to 6.' };
  }

  let debit: ConsumeDebit | undefined;
  try {
    const creditResult = await consumeCreditsForAction({
      userId,
      action: CHUNK_REGEN_CREDIT_ACTION,
      metadata: { endpoint: 'agent-chat', conversationId: conversation.conversationId, jobId, chunkIndex },
    });
    if (!creditResult.ok) {
      return { ok: false, error: 'insufficient_credits' };
    }
    debit = creditResult.debit;

    await ModelTourJob.updateOne({ jobId, 'chunks.index': chunkIndex }, { $set: { 'chunks.$.status': 'regenerating' } });
    const url = await regenerateChunk(jobId, userId, script, chunkIndex);
    await ModelTourJob.updateOne({ jobId, 'chunks.index': chunkIndex }, { $set: { 'chunks.$.status': 'ready', 'chunks.$.url': url } });

    const job = await ModelTourJob.findOne({ jobId }).lean();
    return { ok: true, data: { jobId, chunks: job?.chunks || [] } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scene regeneration failed';
    console.error(`${LOG} regenerate_scene error:`, err);
    await ModelTourJob.updateOne({ jobId, 'chunks.index': chunkIndex }, { $set: { 'chunks.$.status': 'error' } }).catch(() => {});
    if (debit) {
      await refundCreditsForAction({
        userId,
        action: CHUNK_REGEN_CREDIT_ACTION,
        debit,
        metadata: { conversationId: conversation.conversationId, jobId, chunkIndex, reason: 'regeneration_failed', message },
      });
    }
    return { ok: false, error: message };
  }
}

async function executeCombineVideo(conversation: IAgentChatConversation, userId: string): Promise<ToolResult> {
  const jobId = conversation.jobState?.modelTourJobId;
  const script = conversation.jobState?.script;
  if (!jobId || !script) {
    return { ok: false, error: 'No scenes have been generated yet.' };
  }

  const job = await ModelTourJob.findOne({ jobId }).lean();
  if (!job) return { ok: false, error: 'Job not found.' };
  if (job.chunks?.some((c) => c.status === 'regenerating')) {
    return { ok: false, error: 'A scene is still regenerating - wait for it to finish first.' };
  }
  if (job.chunks?.some((c) => c.status === 'error')) {
    return { ok: false, error: 'One or more scenes failed to generate - regenerate them before combining.' };
  }

  const chunkUrls = (job.chunks || [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((c) => c.url);

  await ModelTourJob.updateOne({ jobId }, { $set: { status: 'combining' } });

  try {
    await combineChunksAndHandoff(jobId, userId, script, chunkUrls);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Combine failed';
    console.error(`${LOG} combine_video error:`, err);
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });
    return { ok: false, error: message };
  }

  // combineChunksAndHandoff hands off to the splitter workflow, which calls
  // POST /model-tour/webhook asynchronously to mark the job done - poll for
  // that the same way the pre-chunk-review /model-tour/generate SSE loop did.
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await ModelTourJob.findOne({ jobId }).lean();
    if (current?.status === 'done') {
      return { ok: true, data: { jobId, resultUrl: current.resultUrl } };
    }
    if (current?.status === 'error') {
      return { ok: false, error: current.error || 'Combine failed' };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { ok: false, error: 'Timed out waiting for the final video.' };
}

const EXECUTORS: Record<string, (conversation: IAgentChatConversation, userId: string, args: Record<string, unknown>) => Promise<ToolResult>> = {
  propose_storyboard: executeProposeStoryboard,
  generate_video_scenes: (c, u) => executeGenerateVideoScenes(c, u),
  regenerate_scene: executeRegenerateScene,
  combine_video: (c, u) => executeCombineVideo(c, u),
};

export interface AgentChatUserMessage {
  text: string;
  // Kept separate (not one flat list) so the model can be told directly
  // which is which via the labeled text below, instead of having to guess
  // from context which attached URL belongs in which propose_storyboard arg.
  avatarImageUrls?: string[];
  propertyImageUrls?: string[];
  approvalFor?: string;
}

export type AgentChatEvent =
  | { type: 'tool_started'; tool: string }
  | { type: 'tool_result'; tool: string; data: unknown }
  | { type: 'text_delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

function isApproved(userMessage: AgentChatUserMessage, toolName: string): boolean {
  if (!GATED_TOOLS.has(toolName)) return true;
  return userMessage.approvalFor === toolName;
}

// Manual, single-tool-call-per-turn loop - not the SDK's open-ended agentic
// runner. Every stage needs a human checkpoint, so we never let the model
// chain tool calls unattended: (1) one call with tools+auto to pick at most
// one action, (2) execute it (gated for the two costly/hard-to-undo steps),
// (3) a second call forced to text-only, streamed, which is what the user
// actually watches appear.
export async function runAgentTurn(
  conversation: IAgentChatConversation,
  userId: string,
  userMessage: AgentChatUserMessage,
  send: (event: AgentChatEvent) => void,
): Promise<void> {
  const attachmentLabels: string[] = [];
  if (userMessage.avatarImageUrls?.length) {
    attachmentLabels.push(`Presenter/avatar photos: ${userMessage.avatarImageUrls.join(', ')}`);
  }
  if (userMessage.propertyImageUrls?.length) {
    attachmentLabels.push(`Property photos: ${userMessage.propertyImageUrls.join(', ')}`);
  }
  const userContent = attachmentLabels.length ? `${userMessage.text}\n\n[${attachmentLabels.join(' | ')}]` : userMessage.text;

  const newTurnMessages: ChatCompletionMessageParam[] = [{ role: 'user', content: userContent }];
  const apiMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(conversation.messages as unknown as ChatCompletionMessageParam[]),
    ...newTurnMessages,
  ];

  const firstResponse = await openai.chat.completions.create({
    model: env.openaiModel,
    messages: apiMessages,
    tools: TOOLS,
    tool_choice: 'auto',
    parallel_tool_calls: false,
  });

  const assistantMessage = firstResponse.choices[0]?.message;
  if (!assistantMessage) throw new Error('No response from model');
  newTurnMessages.push(assistantMessage as ChatCompletionMessageParam);
  apiMessages.push(assistantMessage as ChatCompletionMessageParam);

  const toolCall = assistantMessage.tool_calls?.[0];
  if (toolCall && toolCall.type === 'function') {
    const toolName = toolCall.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch {
      // leave args empty - executor will validate required fields itself
    }

    send({ type: 'tool_started', tool: toolName });

    const executor = EXECUTORS[toolName];
    const result: ToolResult = !isApproved(userMessage, toolName)
      ? { ok: false, error: `This step needs the user's explicit approval first. Ask them to confirm before calling ${toolName} again.` }
      : executor
        ? await executor(conversation, userId, args)
        : { ok: false, error: `Unknown tool: ${toolName}` };

    const toolResultMessage: ChatCompletionMessageParam = {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result.ok ? result.data : { error: result.error }),
    };
    newTurnMessages.push(toolResultMessage);
    apiMessages.push(toolResultMessage);

    if (result.ok) {
      send({ type: 'tool_result', tool: toolName, data: result.data });
    }
  }

  const stream = await openai.chat.completions.create({
    model: env.openaiModel,
    messages: apiMessages,
    tool_choice: 'none',
    stream: true,
  });

  let finalText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      finalText += delta;
      send({ type: 'text_delta', text: delta });
    }
  }

  newTurnMessages.push({ role: 'assistant', content: finalText });

  conversation.messages.push(...(newTurnMessages as unknown as Record<string, unknown>[]));
  await conversation.save();

  send({ type: 'done' });
}
