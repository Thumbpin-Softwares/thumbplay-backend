import mongoose, { Document, Model, Schema } from 'mongoose';

// Field-for-field port of thumbpinclient/src/models/User.js - this backend
// shares thumbpinclient's MongoDB database/User collection, so the schema
// must stay wire-compatible (same field names/types/defaults/validators).
export interface IUser extends Document {
  email: string;
  name?: string;
  hashedPassword?: string;
  googleId?: string;
  image?: string;
  credits: number;
  freeVideoGenerationsUsed: number;
  freeAvatarGenerationsUsed: number;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    hashedPassword: {
      type: String,
      required: function (this: IUser) {
        return !this.googleId; // Required if not signed in with Google
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    image: {
      type: String,
    },
    credits: {
      type: Number,
      default: 0,
      min: 0,
    },
    freeVideoGenerationsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    freeAvatarGenerationsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    plan: {
      type: String,
      enum: ['free', 'pro'],
      default: 'free',
    },
  },
  {
    timestamps: true,
  }
);

// Guards against "Cannot overwrite model once compiled" when tsx's watch
// mode re-executes this module on file changes.
export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
