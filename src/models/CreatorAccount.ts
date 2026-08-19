import mongoose, { Document, Schema } from 'mongoose';

export interface ICreatorAccount extends Document {
  userId: mongoose.Types.ObjectId;
  instagramBusinessId?: string;
  pageId?: string;
  facebookPages?: { id: string; name: string }[];
  accessToken?: string; // encrypted
  userAccessToken?: string; // encrypted
  tokenExpiry?: Date;
  username?: string;
  profilePic?: string;
  name?: string;
  followersCount?: number;
  isConnected: boolean;
  scopes: string[];
  profile: {
    bio?: string;
    avatar?: string;
    niche?: string;
    geography?: string;
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
  };
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

const CreatorAccountSchema = new Schema<ICreatorAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    instagramBusinessId: { type: String },
    pageId: { type: String },
    facebookPages: [{ id: { type: String }, name: { type: String } }],
    accessToken: { type: String, select: false }, // encrypted at rest
    userAccessToken: { type: String, select: false }, // encrypted at rest
    tokenExpiry: { type: Date },
    username: { type: String },
    profilePic: { type: String },
    name: { type: String },
    followersCount: { type: Number, default: 0 },
    isConnected: { type: Boolean, default: false },
    scopes: [{ type: String }],
    profile: {
      bio: { type: String },
      avatar: { type: String },
      niche: { type: String },
      geography: { type: String },
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
      currency: { type: String, default: 'USD' }
    },
    embedding: { type: [Number], select: false }
  },
  { timestamps: true }
);

export const CreatorAccount = mongoose.model<ICreatorAccount>('CreatorAccount', CreatorAccountSchema);
