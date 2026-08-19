import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document {
  campaignId?: mongoose.Types.ObjectId;
  brandId?: mongoose.Types.ObjectId;
  creatorId?: mongoose.Types.ObjectId;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpayTransferId?: string;
  type: 'DEPOSIT' | 'PAYOUT';
  amount: number;         // In smallest currency unit (paise)
  currency: string;       // Default INR
  platformFee: number;    // DynamoDM cut
  netAmount: number;      // Amount creator actually receives
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'BrandCampaign' },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
    creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount' },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true },
    razorpayTransferId: { type: String, index: true },
    type: { type: String, enum: ['DEPOSIT', 'PAYOUT'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    platformFee: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'], default: 'PENDING' },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
