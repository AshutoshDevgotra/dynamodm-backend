import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { authenticate, requirePaidSubscription, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { Course } from '../../models/Course';
import { CoursePurchase } from '../../models/CoursePurchase';
import { CreatorAccount } from '../../models/CreatorAccount';
import { CourseAsset, CourseAssetKind } from '../../models/CourseAsset';
import multer from 'multer';

const router = Router();
const PLATFORM_FEE_PERCENT = 10;
const ACADEMY_ADMIN_EMAIL = 'ashutoshdevgotra@gmail.com';
const isAcademyAdmin = (req: AuthRequest) => req.user?.role?.toUpperCase() === 'ADMIN' && req.user.email.toLowerCase() === ACADEMY_ADMIN_EMAIL;
const academyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowed.includes(file.mimetype)) { callback(new AppError('Upload a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.', 400)); return; }
    callback(null, true);
  },
});

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const getCreator = async (userId: string) => {
  const creator = await CreatorAccount.findOne({ userId, isConnected: true });
  if (!creator) throw new AppError('Connect an Instagram account before publishing Academy content.', 409);
  return creator;
};
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw new AppError('Razorpay is not configured.', 503);
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

// Creator workspace
router.get('/creator/courses', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const courses = await Course.find({ creatorId: creator._id }).sort({ createdAt: -1 });
  const enrollmentCounts = await CoursePurchase.aggregate([{ $match: { creatorId: creator._id, status: 'CAPTURED' } }, { $group: { _id: '$courseId', count: { $sum: 1 } } }]);
  const counts = new Map(enrollmentCounts.map((item) => [String(item._id), item.count]));
  res.json({ success: true, data: { courses: courses.map((course) => ({ ...course.toObject(), enrollmentCount: counts.get(String(course._id)) || 0 })) } });
});

router.post('/creator/courses', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const title = String(req.body?.title || '').trim();
  const priceInr = Number(req.body?.priceInr);
  if (title.length < 3 || !Number.isFinite(priceInr) || priceInr < 0 || priceInr > 1000000) throw new AppError('Add a course title and a valid INR price.', 400);
  const baseSlug = slugify(title) || `course-${Date.now()}`;
  const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  const course = await Course.create({ creatorId: creator._id, title, slug, description: String(req.body?.description || '').trim(), category: String(req.body?.category || '').trim(), coverImage: String(req.body?.coverImage || '').trim(), priceInr, status: 'DRAFT' });
  res.status(201).json({ success: true, data: { course } });
});

router.put('/creator/courses/:id', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.id, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const updates: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'category', 'coverImage', 'thumbnailImage']) if (req.body?.[key] !== undefined) updates[key] = String(req.body[key]).trim();
  for (const key of ['showEnrollmentCount', 'showHighlights', 'showBenefits', 'showGallery', 'showTestimonials', 'showFaq', 'showAbout', 'showProducts']) if (req.body?.[key] !== undefined) updates[key] = Boolean(req.body[key]);
  if (req.body?.priceInr !== undefined) {
    const priceInr = Number(req.body.priceInr);
    if (!Number.isFinite(priceInr) || priceInr < 0 || priceInr > 1000000) throw new AppError('Invalid course price.', 400);
    updates.priceInr = priceInr;
  }
  Object.assign(course, updates);
  await course.save();
  res.json({ success: true, data: { course } });
});

router.delete('/creator/courses/:id', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.id, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const capturedEnrollments = await CoursePurchase.countDocuments({ courseId: course._id, status: 'CAPTURED' });
  if (capturedEnrollments > 0) throw new AppError('This course has enrolled students and cannot be deleted. Archive it instead.', 409);
  await CourseAsset.deleteMany({ courseId: course._id });
  await CoursePurchase.deleteMany({ courseId: course._id, status: { $ne: 'CAPTURED' } });
  await course.deleteOne();
  res.json({ success: true, data: { courseId: course._id } });
});

router.post('/creator/courses/:id/assets', authenticate, requirePaidSubscription, academyUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.id, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  if (!req.file) throw new AppError('Choose a file to upload.', 400);
  const requestedKind = String(req.body?.kind || '').toUpperCase() as CourseAssetKind;
  if (!['COVER', 'THUMBNAIL', 'LESSON_VIDEO', 'GALLERY_IMAGE'].includes(requestedKind)) throw new AppError('Invalid Academy upload type.', 400);
  const lessonId = req.body?.lessonId ? String(req.body.lessonId) : undefined;
  if (requestedKind === 'LESSON_VIDEO' && (!lessonId || !course.lessons.some((lesson) => String(lesson._id) === lessonId))) throw new AppError('Choose a valid lesson for this video.', 400);
  const asset = await CourseAsset.create({ courseId: course._id, creatorId: creator._id, lessonId, kind: requestedKind, data: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname });
  const assetUrl = `/api/academy/media/${asset._id}`;
  if (requestedKind === 'COVER') course.coverImage = assetUrl;
  if (requestedKind === 'THUMBNAIL') course.thumbnailImage = assetUrl;
  if (requestedKind === 'LESSON_VIDEO') {
    const lesson = course.lessons.find((item) => String(item._id) === lessonId);
    if (lesson) lesson.videoUrl = assetUrl;
  }
  await course.save();
  res.status(201).json({ success: true, data: { asset: { id: asset._id, url: assetUrl, kind: requestedKind }, course } });
});

router.post('/creator/courses/:id/publish', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOneAndUpdate({ _id: req.params.id, creatorId: creator._id }, { status: 'PUBLISHED' }, { new: true });
  if (!course) throw new AppError('Course not found.', 404);
  res.json({ success: true, data: { course } });
});

router.post('/creator/courses/:id/lessons', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.id, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const title = String(req.body?.title || '').trim();
  if (title.length < 2) throw new AppError('Lesson title is required.', 400);
  course.lessons.push({ title, description: String(req.body?.description || '').trim(), videoUrl: String(req.body?.videoUrl || '').trim(), durationMinutes: Number(req.body?.durationMinutes) || 0, isPreview: Boolean(req.body?.isPreview), isPublished: Boolean(req.body?.isPublished), sortOrder: course.lessons.length } as any);
  await course.save();
  res.status(201).json({ success: true, data: { course } });
});

router.put('/creator/courses/:courseId/lessons/:lessonId', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.courseId, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const lesson = course.lessons.find((item) => String(item._id) === req.params.lessonId);
  if (!lesson) throw new AppError('Lesson not found.', 404);
  for (const key of ['title', 'description', 'videoUrl']) if (req.body?.[key] !== undefined) (lesson as any)[key] = String(req.body[key]).trim();
  for (const key of ['isPreview', 'isPublished']) if (req.body?.[key] !== undefined) (lesson as any)[key] = Boolean(req.body[key]);
  if (!lesson.title || lesson.title.length < 2) throw new AppError('Lesson title is required.', 400);
  await course.save();
  res.json({ success: true, data: { course } });
});

router.delete('/creator/courses/:courseId/lessons/:lessonId', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.courseId, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const lesson = course.lessons.find((item) => String(item._id) === req.params.lessonId);
  if (!lesson) throw new AppError('Lesson not found.', 404);
  await CourseAsset.deleteMany({ courseId: course._id, lessonId: lesson._id });
  course.lessons.splice(course.lessons.indexOf(lesson), 1);
  await course.save();
  res.json({ success: true, data: { course } });
});

router.post('/creator/courses/:id/live', authenticate, requirePaidSubscription, async (req: AuthRequest, res: Response) => {
  const creator = await getCreator(req.user!.id);
  const course = await Course.findOne({ _id: req.params.id, creatorId: creator._id });
  if (!course) throw new AppError('Course not found.', 404);
  const title = String(req.body?.title || '').trim();
  const startsAt = new Date(req.body?.startsAt);
  if (title.length < 2 || Number.isNaN(startsAt.getTime())) throw new AppError('Live session title and start time are required.', 400);
  course.liveSessions.push({ title, description: String(req.body?.description || '').trim(), startsAt, durationMinutes: Math.min(480, Math.max(15, Number(req.body?.durationMinutes) || 60)), roomUrl: String(req.body?.roomUrl || '').trim(), status: 'SCHEDULED' } as any);
  await course.save();
  res.status(201).json({ success: true, data: { course } });
});

// Public course discovery and content metadata
router.get('/public/courses/:slug', async (req: Request, res: Response) => {
  const course = await Course.findOne({ slug: req.params.slug, status: 'PUBLISHED' }).populate('creatorId', 'name igUsername profile');
  if (!course) throw new AppError('Course not found.', 404);
  res.json({ success: true, data: { course } });
});

router.get('/media/:id', async (req: Request, res: Response) => {
  const asset = await CourseAsset.findById(req.params.id).select('+data');
  if (!asset) { res.status(404).json({ success: false, message: 'Academy media not found.' }); return; }
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(asset.data);
});

// Student checkout and enrollment
router.post('/courses/:id/create-order', authenticate, async (req: AuthRequest, res: Response) => {
  const course = await Course.findOne({ _id: req.params.id, status: 'PUBLISHED' });
  if (!course) throw new AppError('Course not found.', 404);
  if (course.priceInr === 0) { res.json({ success: true, data: { freeAccess: true } }); return; }
  const existing = await CoursePurchase.findOne({ courseId: course._id, studentId: req.user!.id, status: 'CAPTURED' });
  if (existing) { res.json({ success: true, data: { alreadyEnrolled: true } }); return; }
  const amount = Math.round(course.priceInr * 100);
  if (amount < 100) throw new AppError('Free courses do not need checkout.', 400);
  const order = await (getRazorpay().orders.create as Function)({ amount, currency: 'INR', receipt: `course_${course._id}_${Date.now()}`, notes: { courseId: course._id.toString(), studentId: req.user!.id } });
  await CoursePurchase.create({ courseId: course._id, creatorId: course.creatorId, studentId: req.user!.id, razorpayOrderId: order.id, amount, platformFee: Math.round(amount * PLATFORM_FEE_PERCENT / 100), creatorAmount: amount - Math.round(amount * PLATFORM_FEE_PERCENT / 100), currency: 'INR', status: 'PENDING' });
  res.json({ success: true, data: { orderId: order.id, amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, courseTitle: course.title } });
});

router.post('/courses/verify', authenticate, async (req: AuthRequest, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) throw new AppError('Missing payment verification fields.', 400);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  if (expected !== razorpay_signature) throw new AppError('Invalid payment signature.', 400);
  const purchase = await CoursePurchase.findOne({ razorpayOrderId: razorpay_order_id, studentId: req.user!.id });
  if (!purchase) throw new AppError('Course order not found.', 404);
  if (purchase.status === 'CAPTURED') { res.json({ success: true, data: { purchaseId: purchase._id } }); return; }
  const payment = await (getRazorpay() as any).payments.fetch(razorpay_payment_id);
  if (payment.status !== 'captured' || payment.order_id !== razorpay_order_id || payment.amount !== purchase.amount || payment.currency !== 'INR') throw new AppError('Payment has not been captured.', 402);
  purchase.razorpayPaymentId = razorpay_payment_id;
  purchase.status = 'CAPTURED';
  await purchase.save();
  // Route the creator share immediately when the creator has completed
  // Razorpay linked-account onboarding. If onboarding is incomplete, the
  // captured purchase remains recorded and can be reconciled later.
  const creator = await CreatorAccount.findById(purchase.creatorId).select('wallet');
  const linkedAccountId = (creator?.wallet as any)?.razorpayAccountId;
  if (linkedAccountId) {
    try {
      const transfer = await ((getRazorpay() as any).transfers.create)({ account: linkedAccountId, amount: purchase.creatorAmount, currency: 'INR', notes: { courseId: purchase.courseId.toString(), purchaseId: purchase._id.toString(), type: 'academy_course_payout' } });
      purchase.razorpayTransferId = transfer.id;
      await purchase.save();
    } catch {
      // Do not roll back student access after a captured payment. The
      // missing transfer is visible through the payout ledger for retry.
    }
  }
  res.json({ success: true, data: { purchaseId: purchase._id } });
});

router.get('/student/enrollments', authenticate, async (req: AuthRequest, res: Response) => {
  if (isAcademyAdmin(req)) {
    const courses = await Course.find({}).populate('creatorId', 'name igUsername profile').sort({ createdAt: -1 });
    res.json({ success: true, data: { isAcademyAdmin: true, enrollments: courses.map((course) => ({ _id: `admin-${course._id}`, courseId: course, adminAccess: true })) } });
    return;
  }
  const purchases = await CoursePurchase.find({ studentId: req.user!.id, status: 'CAPTURED' }).populate({ path: 'courseId', populate: { path: 'creatorId', select: 'name igUsername profile' } }).sort({ createdAt: -1 });
  const purchasedIds = new Set(purchases.map((purchase) => String((purchase.courseId as any)._id || purchase.courseId)));
  const freeCourses = await Course.find({ status: 'PUBLISHED', priceInr: 0, _id: { $nin: [...purchasedIds] } }).populate('creatorId', 'name igUsername profile').sort({ createdAt: -1 });
  const freeEnrollments = freeCourses.map((course) => ({ _id: `free-${course._id}`, courseId: course, freeAccess: true }));
  res.json({ success: true, data: { isAcademyAdmin: false, enrollments: [...purchases, ...freeEnrollments] } });
});

router.get('/student/courses/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const requestedCourse = await Course.findOne({ _id: req.params.id });
  if (!requestedCourse) throw new AppError('Course not found.', 404);
  if (!isAcademyAdmin(req) && requestedCourse.priceInr !== 0) {
    const purchase = await CoursePurchase.findOne({ courseId: req.params.id, studentId: req.user!.id, status: 'CAPTURED' });
    if (!purchase) throw new AppError('Enroll in this course to access the lessons.', 403);
  }
  const course = await Course.findOne(isAcademyAdmin(req) ? { _id: req.params.id } : { _id: req.params.id, status: 'PUBLISHED' }).populate('creatorId', 'name igUsername profile');
  if (!course) throw new AppError('Course not found.', 404);
  res.json({ success: true, data: { course } });
});

export default router;
