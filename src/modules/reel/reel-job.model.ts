import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Field-for-field port of thumbpinclient/src/models/SeedanceJob.js — same
// shared collection (name "SeedanceJob" kept as-is for wire compatibility).
// Shared by all three reel pipelines; some fields (part3Cta, avatarVideoUrl,
// walkthroughVideoUrl, ctaVideoUrl) belong to pipelines not in this port's
// scope but are kept for schema parity with the shared collection.
export type ReelJobStatus = 'running' | 'splitting' | 'voices' | 'seedance' | 'combining' | 'done' | 'error';

export interface IReelJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  status: ReelJobStatus;
  part1?: string;
  part2?: string;
  part3Cta?: string;
  part1AudioUrl?: string;
  part2AudioUrl?: string;
  part3AudioUrl?: string;
  avatarVideoUrl?: string;
  walkthroughVideoUrl?: string;
  ctaVideoUrl?: string;
  part1VideoUrl?: string;
  part2VideoUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReelJobSchema = new Schema<IReelJob>(
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
    status: {
      type: String,
      enum: ['running', 'splitting', 'voices', 'seedance', 'combining', 'done', 'error'],
      default: 'running',
    },
    part1: String,
    part2: String,
    part3Cta: String,
    part1AudioUrl: String,
    part2AudioUrl: String,
    part3AudioUrl: String,
    avatarVideoUrl: String,
    walkthroughVideoUrl: String,
    ctaVideoUrl: String,
    part1VideoUrl: String,
    part2VideoUrl: String,
    error: String,
  },
  {
    timestamps: true,
  },
);

ReelJobSchema.index({ userId: 1, createdAt: -1 });

// Model name "SeedanceJob" (not "ReelJob") — must match the collection name
// thumbpinclient's Mongoose model uses, since this is the same shared collection.
export const ReelJob: Model<IReelJob> =
  mongoose.models.SeedanceJob || mongoose.model<IReelJob>('SeedanceJob', ReelJobSchema);
