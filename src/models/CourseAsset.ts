import mongoose, { Document, Schema } from 'mongoose';

export type CourseAssetKind = 'COVER' | 'THUMBNAIL' | 'LESSON_VIDEO' | 'GALLERY_IMAGE';

export interface ICourseAsset extends Document {
  courseId: mongoose.Types.ObjectId;
  creatorId: mongoose.Types.ObjectId;
  lessonId?: mongoose.Types.ObjectId;
  kind: CourseAssetKind;
  data: Buffer;
  mimeType: string;
  fileName: string;
  createdAt: Date;
  updatedAt: Date;
}

const CourseAssetSchema = new Schema<ICourseAsset>({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true, index: true },
  lessonId: { type: Schema.Types.ObjectId },
  kind: { type: String, enum: ['COVER', 'THUMBNAIL', 'LESSON_VIDEO', 'GALLERY_IMAGE'], required: true },
  data: { type: Buffer, required: true, select: false },
  mimeType: { type: String, required: true },
  fileName: { type: String, required: true },
}, { timestamps: true });

export const CourseAsset = mongoose.model<ICourseAsset>('CourseAsset', CourseAssetSchema);
