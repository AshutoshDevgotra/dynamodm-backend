import mongoose, { Document, Schema } from 'mongoose';

export interface ILink extends Document {
  creatorId: mongoose.Types.ObjectId;
  productId?: mongoose.Types.ObjectId;
  shortCode: string;
  originalUrl: string;
  clicks: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema = new Schema<ILink>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' }, // Optional, linking directly to a product
    shortCode: { type: String, required: true, unique: true },
    originalUrl: { type: String, required: true },
    clicks: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);


export const Link = mongoose.model<ILink>('Link', LinkSchema);
