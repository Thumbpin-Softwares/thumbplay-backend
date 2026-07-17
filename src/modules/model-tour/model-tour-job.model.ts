import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Tracks a single omni-hometour-pipeline generation. Unlike ReelJob (multi
// stage: splitting/voices/seedance/combining), the fal workflow does
// scripting+TTS+video internally in one call, so status is effectively
// binary: running until it isn't.
export type ModelTourJobStatus = 'running' | 'done' | 'error';

export interface ModelTourJobInputs {
  propertyName: string;
  locationLandmarks?: string;
  connectivity?: string;
  language?: string;
  tierClass?: string;
  carpetArea?: string;
  amenities?: string;
  tonality?: string;
  vibe?: string;
  avatarImageUrls: string[];
  propertyImageUrls: string[];
}

export interface IModelTourJob extends Document {
  jobId: string;
  userId: Types.ObjectId;
  status: ModelTourJobStatus;
  inputs: ModelTourJobInputs;
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
    status: {
      type: String,
      enum: ['running', 'done', 'error'],
      default: 'running',
    },
    inputs: {
      propertyName: { type: String, required: true },
      locationLandmarks: String,
      connectivity: String,
      language: String,
      tierClass: String,
      carpetArea: String,
      amenities: String,
      tonality: String,
      vibe: String,
      avatarImageUrls: { type: [String], default: [] },
      propertyImageUrls: { type: [String], default: [] },
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
