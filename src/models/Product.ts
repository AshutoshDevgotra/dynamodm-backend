import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  creatorId: mongoose.Types.ObjectId;
  type: 'AFFILIATE' | 'DIGITAL_PRODUCT' | 'SERVICE' | 'COURSE';
  title: string;
  description?: string;
  imageUrl?: string;
  originalUrl?: string;
  dynamoShortUrl?: string;
  affiliateData?: { network: string; commissionRate: number };
  price?: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true },
    type: { type: String, enum: ['AFFILIATE', 'DIGITAL_PRODUCT', 'SERVICE', 'COURSE'], required: true },
    title: { type: String, required: true },
    description: { type: String },
    imageUrl: { type: String },
    originalUrl: { type: String },
    dynamoShortUrl: { type: String, unique: true, sparse: true },
    affiliateData: { 
      network: { type: String },
      commissionRate: { type: Number }
    },
    price: { type: Number }
  },
  { timestamps: true }
);

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
