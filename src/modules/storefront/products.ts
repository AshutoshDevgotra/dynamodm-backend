import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Product } from '../../models/Product';
import { AppError } from '../../middleware/errorHandler';

const router = Router();
const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
const upload = multer({
  storage: multer.memoryStorage(),
  // Media is stored in the Product document, so stay below MongoDB's 16 MB document limit.
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMediaTypes.includes(file.mimetype)) {
      callback(new AppError('Media must be JPEG, PNG, GIF, WebP, MP4, WebM, or MOV.', 400));
      return;
    }
    callback(null, true);
  },
});

const creatorForUser = async (userId: string) => {
  const creator = await CreatorAccount.findOne({ userId });
  if (!creator) throw new AppError('Connect your Instagram profile before adding products.', 400);
  return creator;
};

const readText = (body: Record<string, unknown>, field: string): string | undefined => {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AppError(`${field} must be text.`, 400);
  return value;
};

const validateHttpUrl = (value: string | undefined, field: string): string | undefined => {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new AppError(`${field} must be a valid URL.`, 400); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError(`${field} must use HTTP or HTTPS.`, 400);
  return parsed.toString();
};

const withoutImageData = <T extends { imageData?: Buffer }>(product: T): Omit<T, 'imageData'> => {
  const response = { ...product } as T;
  delete response.imageData;
  return response;
};

// GET /api/products — products owned by the signed-in creator.
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const creator = await creatorForUser(req.user!.id);
  const products = await Product.find({ creatorId: creator._id }).sort({ createdAt: -1 }).select('-imageData');
  res.json({ success: true, data: { products } });
});

// POST /api/products — create a product and optionally store its image in MongoDB.
router.post('/', authenticate, upload.single('image'), async (req: AuthRequest, res: Response): Promise<void> => {
  const creator = await creatorForUser(req.user!.id);
  const body = req.body as Record<string, unknown>;
  const title = readText(body, 'title')?.trim();
  const originalUrl = readText(body, 'originalUrl')?.trim();
  const description = readText(body, 'description')?.trim();
  const imageUrl = readText(body, 'imageUrl')?.trim();
  const mediaUrl = readText(body, 'mediaUrl')?.trim();
  const requestedMediaType = readText(body, 'mediaType')?.trim();
  const type = readText(body, 'type')?.trim() || 'AFFILIATE';

  if (!title || !originalUrl) throw new AppError('Title and buying link are required.', 400);
  if (!['AFFILIATE', 'DIGITAL_PRODUCT', 'SERVICE', 'COURSE'].includes(type)) throw new AppError('Invalid product type.', 400);
  if (requestedMediaType && !['image', 'video', 'post'].includes(requestedMediaType)) throw new AppError('Invalid media type.', 400);
  if (requestedMediaType === 'post' && !mediaUrl) throw new AppError('A post or reel URL is required.', 400);

  const mediaType = requestedMediaType || (req.file?.mimetype.startsWith('video/') ? 'video' : req.file ? 'image' : undefined);

  const product = await Product.create({
    creatorId: creator._id,
    type,
    title,
    description,
    mediaType,
    mediaUrl: validateHttpUrl(mediaUrl, 'Post or reel URL'),
    originalUrl: validateHttpUrl(originalUrl, 'Buying link'),
    imageUrl: req.file ? undefined : validateHttpUrl(imageUrl, 'Image URL'),
    ...(req.file ? { imageData: req.file.buffer, imageMimeType: req.file.mimetype, imageFileName: req.file.originalname } : {}),
  });

  res.status(201).json({ success: true, data: { product: withoutImageData(product.toObject()) } });
});

// PUT /api/products/:id — update a product owned by the signed-in creator.
router.put('/:id', authenticate, upload.single('image'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError('Product not found.', 404);
  const creator = await creatorForUser(req.user!.id);
  const product = await Product.findOne({ _id: req.params.id, creatorId: creator._id }).select('+imageData');
  if (!product) throw new AppError('Product not found.', 404);

  const body = req.body as Record<string, unknown>;
  const title = readText(body, 'title');
  const description = readText(body, 'description');
  const originalUrl = readText(body, 'originalUrl');
  const imageUrl = readText(body, 'imageUrl');
  const mediaUrl = readText(body, 'mediaUrl');
  const requestedMediaType = readText(body, 'mediaType');
  const type = readText(body, 'type');

  if (title !== undefined) {
    if (!title.trim()) throw new AppError('Title is required.', 400);
    product.title = title.trim();
  }
  if (description !== undefined) product.description = description.trim();
  if (originalUrl !== undefined) {
    const safeUrl = validateHttpUrl(originalUrl, 'Buying link');
    if (!safeUrl) throw new AppError('Buying link is required.', 400);
    product.originalUrl = safeUrl;
  }
  if (type !== undefined) {
    if (!['AFFILIATE', 'DIGITAL_PRODUCT', 'SERVICE', 'COURSE'].includes(type)) throw new AppError('Invalid product type.', 400);
    product.type = type as typeof product.type;
  }
  if (requestedMediaType !== undefined) {
    if (!['image', 'video', 'post'].includes(requestedMediaType)) throw new AppError('Invalid media type.', 400);
    if (requestedMediaType === 'post' && !mediaUrl?.trim() && !product.mediaUrl) throw new AppError('A post or reel URL is required.', 400);
    product.mediaType = requestedMediaType as typeof product.mediaType;
  }
  if (mediaUrl !== undefined) product.mediaUrl = validateHttpUrl(mediaUrl, 'Post or reel URL');
  if (req.file) {
    product.imageData = req.file.buffer;
    product.imageMimeType = req.file.mimetype;
    product.imageFileName = req.file.originalname;
    product.imageUrl = undefined;
    product.mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    product.mediaUrl = undefined;
  } else if (imageUrl !== undefined) {
    const safeImageUrl = validateHttpUrl(imageUrl, 'Image URL');
    product.imageUrl = safeImageUrl;
    product.imageData = undefined;
    product.imageMimeType = undefined;
    product.imageFileName = undefined;
    product.mediaType = 'image';
  }

  await product.save();
  res.json({ success: true, data: { product: withoutImageData(product.toObject()) } });
});

// DELETE /api/products/:id — delete a product owned by the signed-in creator.
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError('Product not found.', 404);
  const creator = await creatorForUser(req.user!.id);
  const product = await Product.findOneAndDelete({ _id: req.params.id, creatorId: creator._id });
  if (!product) throw new AppError('Product not found.', 404);
  res.json({ success: true, data: { productId: product._id } });
});

// GET /api/products/:id/image — public product image for creator storefronts.
router.get('/:id/image', async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404).json({ success: false, message: 'Product image not found.' });
    return;
  }
  const product = await Product.findById(req.params.id).select('+imageData imageMimeType imageFileName');
  if (!product?.imageData) {
    res.status(404).json({ success: false, message: 'Product image not found.' });
    return;
  }
  res.setHeader('Content-Type', product.imageMimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(product.imageData);
});

export default router;
