import mongoose, { Document, Schema } from 'mongoose';

export interface IBrand extends Document {
  userId: mongoose.Types.ObjectId;
  companyName: string;
  website?: string;
  industry?: string;
  budgetRange?: string;
  paymentMethods: { razorpayCustomerId?: string }[];
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  createdAt: Date;
  updatedAt: Date;
}

const BrandSchema = new Schema<IBrand>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyName: { type: String, required: true },
    website: { type: String },
    industry: { type: String },
    budgetRange: { type: String },
    paymentMethods: [{ razorpayCustomerId: { type: String } }],
    verificationStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING' },
  },
  { timestamps: true }
);

export const Brand = mongoose.model<IBrand>('Brand', BrandSchema);
