import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Tracks a single creative-ad generation job — one n8n round-trip per job
// (unlike model-tour's two-phase script/generate split), since a template's
// webhook builds the prompt and renders the image in one call. Status is
// effectively binary: running until it isn't, same as ModelTourJob.
export type CreativeAdJobStatus = 'running' | 'done' | 'error';

export interface ICreativeAdJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  templateKey: string;
  propertyName: string;
  status: CreativeAdJobStatus;
  inputs: Record<string, unknown>;
  resultUrl?: string;
  // Infra cost n8n reported for this generation (informational — the credit
  // charge itself is the flat CREDIT_ACTIONS['creative_ad_generation'] cost
  // taken up front, not derived from this).
  rawCostUsd?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CreativeAdJobSchema = new Schema<ICreativeAdJob>(
  {
    jobId: {
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
    templateKey: {
      type: String,
      required: true,
    },
    propertyName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['running', 'done', 'error'],
      default: 'running',
    },
    inputs: {
      type: Schema.Types.Mixed,
      required: true,
    },
    resultUrl: String,
    rawCostUsd: Number,
    error: String,
  },
  {
    timestamps: true,
  },
);

// Powers both resume-on-refresh lookups (jobId) and the generations list
// (userId + createdAt desc) — same indexing rationale as ModelTourJob.
CreativeAdJobSchema.index({ userId: 1, createdAt: -1 });

export const CreativeAdJob: Model<ICreativeAdJob> =
  mongoose.models.CreativeAdJob || mongoose.model<ICreativeAdJob>('CreativeAdJob', CreativeAdJobSchema);
