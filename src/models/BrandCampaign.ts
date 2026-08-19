import mongoose, { Document, Schema } from 'mongoose';

export interface IBrandCampaign extends Document {
  brandId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  budget: number;
  currency: string;
  requirements: string[];
  deliverables: { platform: string; type: string; count: number }[];
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  proposals: {
    creatorId: mongoose.Types.ObjectId;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED';
    proposedRate?: number;
    message?: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const BrandCampaignSchema = new Schema<IBrandCampaign>(
  {
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    budget: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    requirements: [{ type: String }],
    deliverables: [
      {
        platform: { type: String, required: true },
        type: { type: String, required: true },
        count: { type: Number, required: true, default: 1 }
      }
    ],
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'], default: 'DRAFT' },
    proposals: [
      {
        creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount' },
        status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED'], default: 'PENDING' },
        proposedRate: { type: Number },
        message: { type: String }
      }
    ]
  },
  { timestamps: true }
);

export const BrandCampaign = mongoose.model<IBrandCampaign>('BrandCampaign', BrandCampaignSchema);
