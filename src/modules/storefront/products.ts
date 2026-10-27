import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Product } from '../../models/Product';
import { AppError } from '../../middleware/errorHandler';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype));
  },
});

const creatorForUser = async (userId: string) => {
  const creator = await CreatorAccount.findOne({ userId });
  if (!creator) throw new AppError('Connect your Instagram profile before adding products.', 400);
  return creator;
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
  const { title, description, originalUrl, type = 'AFFILIATE', imageUrl } = req.body as Record<string, string>;
  if (!title?.trim() || !originalUrl?.trim()) throw new AppError('Title and buying link are required.', 400);
  if (!['AFFILIATE', 'DIGITAL_PRODUCT', 'SERVICE', 'COURSE'].includes(type)) throw new AppError('Invalid product type.', 400);

  const file = req.file;
  const validateHttpUrl = (value: string | undefined, field: string) => {
    if (!value) return undefined;
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new AppError(`${field} must be a valid URL.`, 400); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError(`${field} must use HTTP or HTTPS.`, 400);
    return parsed.toString();
  };
  const safeOriginalUrl = validateHttpUrl(originalUrl.trim(), 'Buying link');
  const safeImageUrl = validateHttpUrl(imageUrl?.trim(), 'Image URL');
  const product = await Product.create({
    creatorId: creator._id,
    type,
    title: title.trim(),
    description: description?.trim(),
    originalUrl: safeOriginalUrl,
    imageUrl: safeImageUrl,
    ...(file ? { imageData: file.buffer, imageMimeType: file.mimetype, imageFileName: file.originalname } : {}),
  });

  const productResponse = product.toObject();
  delete (productResponse as { imageData?: Buffer }).imageData;
  res.status(201).json({ success: true, data: { product: productResponse } });
});

// GET /api/products/:id/image — public product image for creator storefronts.
router.get('/:id/image', async (req: Request, res: Response): Promise<void> => {
  const product = await Product.findById(req.params.id).select('+imageData imageMimeType imageFileName');
  if (!product?.imageData) {
    res.status(404).json({ success: false, message: 'Product image not found.' });
    return;
  }
  res.setHeader('Content-Type', product.imageMimeType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(product.imageData);
});

export default router;
