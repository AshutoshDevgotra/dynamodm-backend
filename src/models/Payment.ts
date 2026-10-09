import mongoose, { Document, Schema } from 'mongoose';

export interface IPayment extends Document {
  userId: mongoose.Types.ObjectId;
  subscriptionId?: mongoose.Types.ObjectId;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  provider: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  idempotencyKey?: string;
  plan: 'pro' | 'premium';
  amount: number; // in paise
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  description?: string;
  invoiceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    razorpayPaymentId: { type: String },
    razorpayOrderId: { type: String },
    razorpaySignature: { type: String, select: false },
    provider: { type: String, default: 'razorpay' },
    providerOrderId: { type: String, index: true },
    providerPaymentId: { type: String, index: true, sparse: true },
    idempotencyKey: { type: String, index: true, sparse: true },
    plan: { type: String, enum: ['pro', 'premium'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'authorized', 'captured', 'refunded', 'failed'],
      default: 'created',
    },
    method: { type: String },
    description: { type: String },
    invoiceUrl: { type: String },
  },
  { timestamps: true }
);

PaymentSchema.index({ userId: 1, providerOrderId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);
