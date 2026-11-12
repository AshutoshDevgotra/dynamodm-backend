import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IPendingSignup extends Document {
  email: string;
  name: string;
  password: string;
  role: 'CREATOR' | 'BRAND';
  verificationCodeHash: string;
  verificationCodeExpiry: Date;
  expiresAt: Date;
}

const PendingSignupSchema = new Schema<IPendingSignup>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['CREATOR', 'BRAND'], required: true },
    verificationCodeHash: { type: String, required: true, select: false },
    verificationCodeExpiry: { type: Date, required: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

PendingSignupSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

export const PendingSignup = mongoose.model<IPendingSignup>('PendingSignup', PendingSignupSchema);
