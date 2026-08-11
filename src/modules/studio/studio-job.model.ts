import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Tracks a single Studio generation job. Unlike creative-ads/model-tour,
// Studio jobs run detached from the request that created them (see
// studio.controller.ts) so they survive the client disconnecting - status
// is only ever observed via polling, never streamed.
export type StudioJobStatus = 'running' | 'done' | 'error';
export type StudioWorkType = 'drone-flythrough';

export interface IStudioJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  workType: StudioWorkType;
  prompt?: string;
  imageUrls: string[];
  status: StudioJobStatus;
  resultUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StudioJobSchema = new Schema<IStudioJob>(
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
    workType: {
      type: String,
      required: true,
    },
    prompt: {
      type: String,
      default: '',
    },
    imageUrls: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['running', 'done', 'error'],
      default: 'running',
    },
    resultUrl: String,
    error: String,
  },
  {
    timestamps: true,
  },
);

// Powers both resume-on-refresh lookups (jobId) and the generations list
// (userId + createdAt desc).
StudioJobSchema.index({ userId: 1, createdAt: -1 });

export const StudioJob: Model<IStudioJob> =
  mongoose.models.StudioJob || mongoose.model<IStudioJob>('StudioJob', StudioJobSchema);
