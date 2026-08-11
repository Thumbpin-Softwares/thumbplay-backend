import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// Field-for-field port of thumbpinclient/src/models/CreditTransaction.js -
// same shared collection as thumbpinclient, so enum values must stay in sync.
export type CreditEventType =
  | 'free_quota_consumed'
  | 'credits_debited'
  | 'credits_refunded'
  | 'credits_added'
  | 'credits_set'
  | 'subscription_recharge'
  | 'admin_adjustment';

export type CreditTransactionMode = 'free_quota' | 'paid_credits' | 'system' | 'admin';

export interface ICreditTransaction extends Document {
  userId: Types.ObjectId;
  action: string;
  eventType: CreditEventType;
  mode: CreditTransactionMode;
  creditsDelta: number;
  balanceAfter: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        'free_quota_consumed',
        'credits_debited',
        'credits_refunded',
        'credits_added',
        'credits_set',
        'subscription_recharge',
        'admin_adjustment',
      ],
      required: true,
    },
    mode: {
      type: String,
      enum: ['free_quota', 'paid_credits', 'system', 'admin'],
      required: true,
    },
    creditsDelta: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      default: null,
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

// Newest-first is the only access pattern this collection is queried with
// (a user's own activity feed) - index matches that exactly.
CreditTransactionSchema.index({ userId: 1, createdAt: -1 });

export const CreditTransaction: Model<ICreditTransaction> =
  mongoose.models.CreditTransaction || mongoose.model<ICreditTransaction>('CreditTransaction', CreditTransactionSchema);
