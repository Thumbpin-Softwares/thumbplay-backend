import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Persists one chat conversation for the agentic storyboard->scenes->combine
// flow. `messages` stores raw OpenAI chat-message objects (system/user/
// assistant/tool roles) verbatim, replayed as-is on every turn - same
// "don't reshape what the provider owns" principle as ModelTourJob.inputs
// storing the n8n script verbatim.
//
// `jobState` tracks which model-tour job (if any) this conversation is
// currently driving - the same ModelTourJob doc that GET /model-tour/jobs/:id
// already exposes, so a mid-generation page refresh can still poll it
// independently of the chat conversation itself.
export interface IAgentChatJobState {
  modelTourJobId?: string;
  script?: Record<string, unknown>;
}

export interface IAgentChatConversation extends Document {
  conversationId: string;
  userId: Types.ObjectId;
  messages: Record<string, unknown>[];
  jobState: IAgentChatJobState;
  createdAt: Date;
  updatedAt: Date;
}

const AgentChatConversationSchema = new Schema<IAgentChatConversation>(
  {
    conversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    messages: [Schema.Types.Mixed],
    jobState: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

AgentChatConversationSchema.index({ userId: 1, createdAt: -1 });

export const AgentChatConversation: Model<IAgentChatConversation> =
  mongoose.models.AgentChatConversation ||
  mongoose.model<IAgentChatConversation>('AgentChatConversation', AgentChatConversationSchema);
