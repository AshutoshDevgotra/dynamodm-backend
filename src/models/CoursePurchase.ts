import mongoose, { Document, Schema } from 'mongoose';

export type CoursePurchaseStatus = 'PENDING' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

export interface ICoursePurchase extends Document {
  courseId: mongoose.Types.ObjectId;
  creatorId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpayTransferId?: string;
  amount: number;
  platformFee: number;
  creatorAmount: number;
  currency: string;
  status: CoursePurchaseStatus;
  createdAt: Date;
  updatedAt: Date;
}

const CoursePurchaseSchema = new Schema<ICoursePurchase>({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  razorpayOrderId: { type: String, required: true, unique: true, index: true },
  razorpayPaymentId: { type: String, index: true },
  razorpayTransferId: { type: String, index: true },
  amount: { type: Number, required: true, min: 100 },
  platformFee: { type: Number, required: true, min: 0 },
  creatorAmount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['PENDING', 'CAPTURED', 'FAILED', 'REFUNDED'], default: 'PENDING', index: true },
}, { timestamps: true });

CoursePurchaseSchema.index({ courseId: 1, studentId: 1 }, { unique: true });

export const CoursePurchase = mongoose.model<ICoursePurchase>('CoursePurchase', CoursePurchaseSchema);
