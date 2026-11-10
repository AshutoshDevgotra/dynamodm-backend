import mongoose, { Document, Schema } from 'mongoose';

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface ICourseLesson {
  _id?: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  videoUrl?: string;
  durationMinutes?: number;
  isPreview: boolean;
  isPublished: boolean;
  sortOrder: number;
}

export interface ICourseLiveSession {
  _id?: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  startsAt: Date;
  durationMinutes: number;
  roomUrl?: string;
  replayUrl?: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
}

export interface ICourse extends Document {
  creatorId: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  description?: string;
  category?: string;
  coverImage?: string;
  thumbnailImage?: string;
  showEnrollmentCount: boolean;
  showHighlights: boolean;
  showBenefits: boolean;
  showGallery: boolean;
  showTestimonials: boolean;
  showFaq: boolean;
  showAbout: boolean;
  showProducts: boolean;
  priceInr: number;
  status: CourseStatus;
  lessons: ICourseLesson[];
  liveSessions: ICourseLiveSession[];
  createdAt: Date;
  updatedAt: Date;
}

const LessonSchema = new Schema<ICourseLesson>({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, maxlength: 1000 },
  videoUrl: { type: String, maxlength: 2000 },
  durationMinutes: { type: Number, min: 0, max: 1440 },
  isPreview: { type: Boolean, default: false },
  isPublished: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
});

const LiveSessionSchema = new Schema<ICourseLiveSession>({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, maxlength: 1000 },
  startsAt: { type: Date, required: true },
  durationMinutes: { type: Number, min: 15, max: 480, default: 60 },
  roomUrl: { type: String, maxlength: 2000 },
  replayUrl: { type: String, maxlength: 2000 },
  status: { type: String, enum: ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED'], default: 'SCHEDULED' },
});

const CourseSchema = new Schema<ICourse>({
  creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  description: { type: String, maxlength: 5000 },
  category: { type: String, maxlength: 80 },
  coverImage: { type: String, maxlength: 2000 },
  thumbnailImage: { type: String, maxlength: 2000 },
  showEnrollmentCount: { type: Boolean, default: true },
  showHighlights: { type: Boolean, default: true },
  showBenefits: { type: Boolean, default: false },
  showGallery: { type: Boolean, default: false },
  showTestimonials: { type: Boolean, default: false },
  showFaq: { type: Boolean, default: false },
  showAbout: { type: Boolean, default: false },
  showProducts: { type: Boolean, default: false },
  priceInr: { type: Number, required: true, min: 0, max: 1000000 },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT', index: true },
  lessons: { type: [LessonSchema], default: [] },
  liveSessions: { type: [LiveSessionSchema], default: [] },
}, { timestamps: true });

CourseSchema.index({ creatorId: 1, status: 1, createdAt: -1 });

export const Course = mongoose.model<ICourse>('Course', CourseSchema);
