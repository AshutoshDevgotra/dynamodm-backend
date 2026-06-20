import mongoose, { Document, Schema } from 'mongoose';

export interface ICreatorAccount extends Document {
  userId: mongoose.Types.ObjectId;
  instagramBusinessId?: string;
  pageId?: string;
  accessToken?: string; // encrypted
  tokenExpiry?: Date;
  username?: string;
  profilePic?: string;
  name?: string;
  followersCount?: number;
  isConnected: boolean;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CreatorAccountSchema = new Schema<ICreatorAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    instagramBusinessId: { type: String },
    pageId: { type: String },
    accessToken: { type: String, select: false }, // encrypted at rest
    tokenExpiry: { type: Date },
    username: { type: String },
    profilePic: { type: String },
    name: { type: String },
    followersCount: { type: Number, default: 0 },
    isConnected: { type: Boolean, default: false },
    scopes: [{ type: String }],
  },
  { timestamps: true }
);

export const CreatorAccount = mongoose.model<ICreatorAccount>('CreatorAccount', CreatorAccountSchema);
