import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Field-for-field port of thumbpinclient/src/models/Asset.js — same shared
// collection. Used both for the full CRUD surface in asset.controller.ts
// and directly via Asset.create(...) by every pipeline that records its
// own generated clips/exports.
export type AssetType =
  | 'avatar'
  | 'product'
  | 'background'
  | 'video'
  | 'clip'
  | 'composite'
  | 'presenter'
  | 'overlay';

export interface IAsset extends Document {
  userId: Types.ObjectId;
  name: string;
  url: string;
  type: AssetType;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<IAsset>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['avatar', 'product', 'background', 'video', 'clip', 'composite', 'presenter', 'overlay'],
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

AssetSchema.index({ userId: 1, createdAt: -1 });

export const Asset: Model<IAsset> = mongoose.models.Asset || mongoose.model<IAsset>('Asset', AssetSchema);
