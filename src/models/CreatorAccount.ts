import mongoose, { Document, Schema } from 'mongoose';

export interface ICreatorAccount extends Document {
  userId: mongoose.Types.ObjectId;
  igUserId?: string; // Instagram user ID from OAuth
  igUsername?: string;
  storefrontUsername?: string;
  igAccessToken?: string; // encrypted long-lived token
  igTokenExpiresAt?: Date; // 60-day expiry
  name?: string;
  profilePic?: string;
  followersCount?: number;
  isConnected: boolean;
  reconnectRequired?: boolean;
  reconnectReason?: string;
  scopes: string[];
  profile: {
    bio?: string;
    avatar?: string;
    niche?: string;
    geography?: string;
    followEnabled?: boolean;
    followEmailOnly?: boolean;
    followThankYouTitle?: string;
    followThankYouDescription?: string;
    audienceDemographics?: {
      topAgeRanges: { age: string; percentage: number }[];
      topGenders: { gender: string; percentage: number }[];
      topCities: { city: string; percentage: number }[];
      topCountries: { country: string; percentage: number }[];
    };
  };
  wallet: {
    pendingBalance: number;
    availableBalance: number;
    currency: string;
    razorpayAccountId?: string;
    upiId?: string;
    bankName?: string;
    accountHolderName?: string;
    ifscCode?: string;
    bankAccountLast4?: string;
    bankAccountNumberEncrypted?: string;
  };
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

const CreatorAccountSchema = new Schema<ICreatorAccount>(
  {
  // A Creator subscription can connect up to five distinct IG identities.
  // Do not make this unique; the pair (userId, igUserId) is the identity.
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    igUserId: { type: String },
    igUsername: { type: String },
    storefrontUsername: { type: String, trim: true, lowercase: true, maxlength: 30, index: true, sparse: true },
    igAccessToken: { type: String, select: false }, // encrypted at rest
    igTokenExpiresAt: { type: Date },
    name: { type: String },
    profilePic: { type: String },
    followersCount: { type: Number, default: 0 },
    isConnected: { type: Boolean, default: false },
    reconnectRequired: { type: Boolean, default: false },
    reconnectReason: { type: String },
    scopes: [{ type: String }],
    profile: {
      bio: { type: String },
      avatar: { type: String },
      niche: { type: String },
      geography: { type: String },
      followEnabled: { type: Boolean, default: true },
      followEmailOnly: { type: Boolean, default: true },
      followThankYouTitle: { type: String, maxlength: 120 },
      followThankYouDescription: { type: String, maxlength: 500 },
      audienceDemographics: {
        topAgeRanges: [{ age: String, percentage: Number }],
        topGenders: [{ gender: String, percentage: Number }],
        topCities: [{ city: String, percentage: Number }],
        topCountries: [{ country: String, percentage: Number }]
      }
    },
    wallet: {
      pendingBalance: { type: Number, default: 0 },
      availableBalance: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      razorpayAccountId: { type: String },
      upiId: { type: String, trim: true, lowercase: true, maxlength: 120 },
      bankName: { type: String, trim: true, maxlength: 120 },
      accountHolderName: { type: String, trim: true, maxlength: 120 },
      ifscCode: { type: String, trim: true, uppercase: true, maxlength: 11 },
      bankAccountLast4: { type: String, trim: true, maxlength: 4 },
      bankAccountNumberEncrypted: { type: String, select: false }
    },
    embedding: { type: [Number], select: false }
  },
  { timestamps: true }
);

export const CreatorAccount = mongoose.model<ICreatorAccount>('CreatorAccount', CreatorAccountSchema);
