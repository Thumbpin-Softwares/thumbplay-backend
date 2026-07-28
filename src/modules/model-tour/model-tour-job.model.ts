import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Tracks a single model-tour generation, driven end-to-end by an n8n
// workflow. The finalize step lets the user edit the n8n-generated script
// before generation, so `inputs` holds that script verbatim (n8n owns its
// shape — gender, master prompt, etc. are added by n8n, not us) rather than
// a fixed set of fields. Status is effectively binary: running until it isn't.
export type ModelTourJobStatus = 'running' | 'done' | 'error';

export interface IModelTourJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  propertyName: string;
  status: ModelTourJobStatus;
  inputs: Record<string, unknown>;
  resultUrl?: string;
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
      enum: ['running', 'done', 'error'],
      default: 'running',
    },
    inputs: {
      type: Schema.Types.Mixed,
      required: true,
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
ModelTourJobSchema.index({ userId: 1, createdAt: -1 });

export const ModelTourJob: Model<IModelTourJob> =
  mongoose.models.ModelTourJob || mongoose.model<IModelTourJob>('ModelTourJob', ModelTourJobSchema);
