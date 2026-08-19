import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Tracks a single model-tour job - either a script-generation job (/script,
// result holds the n8n-generated script JSON) or a video-generation job
// (/generate, resultUrl holds the final R2 video URL) - driven end-to-end by
// an n8n workflow. The finalize step lets the user edit the n8n-generated
// script before generation, so `inputs` holds that script verbatim (n8n owns
// its shape - gender, master prompt, etc. are added by n8n, not us) rather
// than a fixed set of fields.
//
// A video-generation job now pauses at 'chunks_ready' (all 6 scene clips
// generated, not yet combined) so the frontend can show them for review -
// see chunks. 'combining' covers the window from the user's Export click
// through the sticher + splitter/voice-change handoff, same as 'running'
// covered the whole pipeline before this existed.
export type ModelTourJobStatus = 'running' | 'chunks_ready' | 'combining' | 'done' | 'error';
export type ModelTourChunkStatus = 'ready' | 'regenerating' | 'error';

// url is '' when a chunk has never successfully generated (failed on the
// initial parallel-generation pass) - a chunk that fails on a later
// regenerate attempt keeps its last-good url instead, so the user doesn't
// lose the previous version just because a retry failed.
export interface IModelTourChunk {
  index: number;
  url: string;
  status: ModelTourChunkStatus;
}

export interface IModelTourJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  propertyName: string;
  status: ModelTourJobStatus;
  inputs: Record<string, unknown>;
  chunks?: IModelTourChunk[];
  // The ConsumeDebit returned when the real_estate_video credit charge was
  // made for this job (see credit.service.ts). Stored so a stuck-job
  // watchdog can refund it later without needing the original in-memory
  // debit object, which doesn't survive past the request that created it.
  creditDebit?: Record<string, unknown>;
  resultUrl?: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModelTourJobSchema = new Schema<IModelTourJob>(
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
    propertyName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['running', 'chunks_ready', 'combining', 'done', 'error'],
      default: 'running',
    },
    inputs: {
      type: Schema.Types.Mixed,
      required: true,
    },
    chunks: [
      {
        _id: false,
        index: { type: Number, required: true },
        url: { type: String, default: '' },
        status: { type: String, enum: ['ready', 'regenerating', 'error'], default: 'ready' },
      },
    ],
    creditDebit: Schema.Types.Mixed,
    resultUrl: String,
    result: Schema.Types.Mixed,
    error: String,
  },
  {
    timestamps: true,
  },
);

// Powers both resume-on-refresh lookups (jobId) and the generations list
// (userId + createdAt desc).
ModelTourJobSchema.index({ userId: 1, createdAt: -1 });

export const ModelTourJob: Model<IModelTourJob> =
  mongoose.models.ModelTourJob || mongoose.model<IModelTourJob>('ModelTourJob', ModelTourJobSchema);
